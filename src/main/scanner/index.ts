import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import os from 'node:os';
import { walkFolder } from './walk';
import { isBinaryBuffer, isExcludedAssetPath } from './fileFilters';
import { detectLang } from '../parsers/languages';
import { countLines } from '../parsers/lineParser';
import { scanTags } from '../parsers/tagScanner';
import { findFunctions } from '../parsers/funcDetect';
import { findDuplicateSlices } from '../parsers/duplicate';
import { getDb } from '../db';
import { DEFAULT_DUPLICATE_LINES, type ScanProgress, type ScanOptions, type FolderRules } from '../../shared/api';

export type ProgressCb = (p: ScanProgress) => void;

let cancelFlag = false;
export function cancelScan(): void { cancelFlag = true; }

interface ParsedFile {
  relPath: string;
  ext: string;
  lang: string;
  size: number;
  mtime: number;
  hash: string;
  total: number;
  code: number;
  comment: number;
  blank: number;
  blockComment: number;
  tags: ReturnType<typeof scanTags>;
  functions: ReturnType<typeof findFunctions>;
  duplicates: ReturnType<typeof findDuplicateSlices>;
  cached: boolean;
  duplicatesRefreshed: boolean;
}

async function hashContent(buf: Buffer): Promise<string> {
  return createHash('sha1').update(buf).digest('hex');
}

async function refreshDuplicateSlices(abs: string, size: number, duplicateMinLines: number): Promise<ReturnType<typeof findDuplicateSlices> | null> {
  let buf: Buffer;
  try { buf = await fs.readFile(abs); } catch { return null; }
  if (isBinaryBuffer(buf) || size > 5 * 1024 * 1024) return [];
  return findDuplicateSlices(buf.toString('utf-8'), duplicateMinLines);
}

function hasActiveDuplicateRules(rules: FolderRules | undefined): rules is FolderRules {
  return Boolean(rules && (rules.whitelist.length > 0 || rules.blacklist.length > 0));
}

async function resolveDuplicateEligiblePaths(root: string, relPaths: string[], rules: FolderRules | undefined): Promise<Set<string> | null> {
  if (!hasActiveDuplicateRules(rules)) return null;

  const duplicateRulePaths = await walkFolder({
    root,
    whitelist: rules.whitelist,
    blacklist: rules.blacklist,
  });
  const allowed = new Set(duplicateRulePaths);
  return new Set(relPaths.filter(relPath => allowed.has(relPath)));
}

export async function scanFolder(
  folderId: number,
  root: string,
  rules: FolderRules,
  opts: ScanOptions,
  onProgress: ProgressCb,
): Promise<{ scanned: number; cacheHits: number }> {
  cancelFlag = false;
  const db = getDb();
  const duplicateMinLines = Math.max(3, Math.floor(opts.duplicateMinLines ?? DEFAULT_DUPLICATE_LINES));

  onProgress({ folderId, phase: 'walking', total: 0, done: 0 });
  const relPaths = await walkFolder({ root, whitelist: rules.whitelist, blacklist: rules.blacklist });
  const duplicateEligiblePaths = opts.detectDuplicates
    ? await resolveDuplicateEligiblePaths(root, relPaths, opts.duplicateRules)
    : null;
  const total = relPaths.length;
  onProgress({ folderId, phase: 'parsing', total, done: 0 });

  // Existing rows for cache lookup.
  const existingStmt = db.prepare(
    'SELECT id, size, mtime, hash, total, code, comment, blank, block_comment as blockComment, lang, ext FROM files WHERE folder_id = ? AND rel_path = ?',
  );

  const limit = pLimit(Math.max(2, os.cpus().length));
  let done = 0;
  let cacheHits = 0;

  const parsed: ParsedFile[] = [];
  await Promise.all(relPaths.map(rel => limit(async () => {
    if (cancelFlag) return;
    if (isExcludedAssetPath(rel)) { done++; return; }

    const abs = path.join(root, rel);
    let stat;
    try { stat = await fs.stat(abs); } catch { done++; return; }
    if (!stat.isFile()) { done++; return; }

    const duplicateAllowed = !opts.detectDuplicates
      || duplicateEligiblePaths == null
      || duplicateEligiblePaths.has(rel);

    const { ext, lang, langId } = detectLang(rel);
    const sizeNum = stat.size;
    const mtimeNum = Math.floor(stat.mtimeMs);

    const existing = existingStmt.get(folderId, rel) as {
      id: number; size: number; mtime: number; hash: string;
      total: number; code: number; comment: number; blank: number; blockComment: number;
      lang: string; ext: string;
    } | undefined;

    // Quick cache hit on size+mtime — skip hashing.
    if (!opts.full && existing && existing.lang !== 'Binary' && existing.size === sizeNum && existing.mtime === mtimeNum) {
      const duplicates = opts.detectDuplicates
        ? (duplicateAllowed ? await refreshDuplicateSlices(abs, sizeNum, duplicateMinLines) : [])
        : null;
      cacheHits++;
      parsed.push({
        relPath: rel, ext: existing.ext, lang: existing.lang,
        size: sizeNum, mtime: mtimeNum, hash: existing.hash,
        total: existing.total, code: existing.code, comment: existing.comment,
        blank: existing.blank, blockComment: existing.blockComment,
        tags: [], functions: [], duplicates: duplicates ?? [],
        cached: true,
        duplicatesRefreshed: duplicates != null,
      });
      done++;
      if (done % 50 === 0) onProgress({ folderId, phase: 'parsing', total, done, cacheHits, current: rel });
      return;
    }

    let buf: Buffer;
    try { buf = await fs.readFile(abs); } catch { done++; return; }

    if (isBinaryBuffer(buf)) {
      done++;
      if (done % 50 === 0) onProgress({ folderId, phase: 'parsing', total, done, cacheHits, current: rel });
      return;
    }

    const hash = await hashContent(buf);

    if (!opts.full && existing && existing.lang !== 'Binary' && existing.hash === hash && existing.size === sizeNum) {
      const duplicates = opts.detectDuplicates && duplicateAllowed && sizeNum <= 5 * 1024 * 1024
        ? findDuplicateSlices(buf.toString('utf-8'), duplicateMinLines)
        : [];
      cacheHits++;
      parsed.push({
        relPath: rel, ext: existing.ext, lang: existing.lang,
        size: sizeNum, mtime: mtimeNum, hash,
        total: existing.total, code: existing.code, comment: existing.comment,
        blank: existing.blank, blockComment: existing.blockComment,
        tags: [], functions: [], duplicates,
        cached: true,
        duplicatesRefreshed: Boolean(opts.detectDuplicates),
      });
      done++;
      if (done % 50 === 0) onProgress({ folderId, phase: 'parsing', total, done, cacheHits, current: rel });
      return;
    }

    // Skip parsing for huge files (>5MB) — count newlines only.
    if (sizeNum > 5 * 1024 * 1024) {
      let newlines = 0;
      for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) newlines++;
      parsed.push({
        relPath: rel, ext, lang: langId,
        size: sizeNum, mtime: mtimeNum, hash,
        total: newlines + 1, code: newlines + 1, comment: 0, blank: 0, blockComment: 0,
        tags: [], functions: [], duplicates: [],
        cached: false,
        duplicatesRefreshed: false,
      });
      done++;
      return;
    }

    const content = buf.toString('utf-8');
    const counts = countLines(content, lang);
    const tags = scanTags(content, lang);
    const functions = findFunctions(content, ext);
    const duplicates = opts.detectDuplicates && duplicateAllowed ? findDuplicateSlices(content, duplicateMinLines) : [];

    parsed.push({
      relPath: rel, ext, lang: langId,
      size: sizeNum, mtime: mtimeNum, hash,
      total: counts.total, code: counts.code, comment: counts.comment,
      blank: counts.blank, blockComment: counts.blockComment,
      tags, functions, duplicates,
      cached: false,
      duplicatesRefreshed: false,
    });
    done++;
    if (done % 25 === 0) onProgress({ folderId, phase: 'parsing', total, done, cacheHits, current: rel });
  })));

  if (cancelFlag) {
    onProgress({ folderId, phase: 'done', total, done, cacheHits });
    return { scanned: done, cacheHits };
  }

  onProgress({ folderId, phase: 'persisting', total, done, cacheHits });

  // Persist in single transaction.
  const upsert = db.prepare(`
    INSERT INTO files (folder_id, rel_path, lang, ext, size, mtime, hash, total, code, comment, blank, block_comment, scanned_at, deleted)
    VALUES (@folder_id, @rel_path, @lang, @ext, @size, @mtime, @hash, @total, @code, @comment, @blank, @block_comment, @scanned_at, 0)
    ON CONFLICT(folder_id, rel_path) DO UPDATE SET
      lang = excluded.lang,
      ext = excluded.ext,
      size = excluded.size,
      mtime = excluded.mtime,
      hash = excluded.hash,
      total = excluded.total,
      code = excluded.code,
      comment = excluded.comment,
      blank = excluded.blank,
      block_comment = excluded.block_comment,
      scanned_at = excluded.scanned_at,
      deleted = 0
  `);
  const getId = db.prepare('SELECT id FROM files WHERE folder_id = ? AND rel_path = ?');
  const delTags = db.prepare('DELETE FROM tags WHERE file_id = ?');
  const insTag = db.prepare('INSERT INTO tags (file_id, kind, line_no, text) VALUES (?, ?, ?, ?)');
  const delFns = db.prepare('DELETE FROM functions WHERE file_id = ?');
  const insFn = db.prepare('INSERT INTO functions (file_id, name, start_line, end_line, length) VALUES (?, ?, ?, ?, ?)');
  const delDup = db.prepare('DELETE FROM duplicates WHERE file_id = ?');
  const insDup = db.prepare('INSERT INTO duplicates (hash, file_id, start_line, end_line) VALUES (?, ?, ?, ?)');
  const markDeleted = db.prepare('UPDATE files SET deleted = 1 WHERE folder_id = ? AND rel_path NOT IN (SELECT value FROM json_each(?))');

  const now = Date.now();

  const tx = db.transaction(() => {
    for (const f of parsed) {
      upsert.run({
        folder_id: folderId,
        rel_path: f.relPath,
        lang: f.lang,
        ext: f.ext,
        size: f.size,
        mtime: f.mtime,
        hash: f.hash,
        total: f.total,
        code: f.code,
        comment: f.comment,
        blank: f.blank,
        block_comment: f.blockComment,
        scanned_at: now,
      });
      if (!f.cached) {
        const row = getId.get(folderId, f.relPath) as { id: number };
        const id = row.id;
        delTags.run(id);
        for (const t of f.tags) insTag.run(id, t.kind, t.lineNo, t.text);
        delFns.run(id);
        for (const fn of f.functions) insFn.run(id, fn.name, fn.startLine, fn.endLine, fn.length);
        if (opts.detectDuplicates) {
          delDup.run(id);
          for (const d of f.duplicates) insDup.run(d.hash, id, d.startLine, d.endLine);
        }
      } else if (opts.detectDuplicates && f.duplicatesRefreshed) {
        const row = getId.get(folderId, f.relPath) as { id: number };
        const id = row.id;
        delDup.run(id);
        for (const d of f.duplicates) insDup.run(d.hash, id, d.startLine, d.endLine);
      }
    }
    markDeleted.run(folderId, JSON.stringify(parsed.map(p => p.relPath)));
  });
  tx();

  onProgress({ folderId, phase: 'done', total, done: total, cacheHits });
  return { scanned: parsed.length, cacheHits };
}
