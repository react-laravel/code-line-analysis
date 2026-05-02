import { getDb } from './db';
import type {
  FolderStats, DirNode, TopFile, TopFunction, TagRow, HeatmapBucket, DuplicateCluster, TopFileSortKey,
} from '../shared/api';
import { DEFAULT_DUPLICATE_LINES } from '../shared/api';

function getDuplicateMinLines(db: ReturnType<typeof getDb>, folderId: number): number {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(`duplicateMinLines:${folderId}`) as { value: string } | undefined;
  if (!row) return DEFAULT_DUPLICATE_LINES;
  const parsed = Number(row.value);
  return Number.isInteger(parsed) && parsed >= 3 ? parsed : DEFAULT_DUPLICATE_LINES;
}

export function getSummary(folderId: number): FolderStats {
  const db = getDb();
  const totals = db.prepare(`
    SELECT COUNT(*) AS files, COALESCE(SUM(total),0) AS total,
           COALESCE(SUM(code),0) AS code, COALESCE(SUM(comment),0) AS comment,
           COALESCE(SUM(blank),0) AS blank, COALESCE(SUM(block_comment),0) AS blockComment
    FROM files WHERE folder_id = ? AND deleted = 0
  `).get(folderId) as { files: number; total: number; code: number; comment: number; blank: number; blockComment: number };

  const byLang = db.prepare(`
    SELECT lang, COUNT(*) AS files, SUM(total) AS total, SUM(code) AS code,
           SUM(comment) AS comment, SUM(blank) AS blank
    FROM files WHERE folder_id = ? AND deleted = 0
    GROUP BY lang ORDER BY total DESC
  `).all(folderId) as Array<{ lang: string; files: number; total: number; code: number; comment: number; blank: number }>;

  const tagCountsRaw = db.prepare(`
    SELECT kind, COUNT(*) AS c FROM tags
    JOIN files ON tags.file_id = files.id
    WHERE files.folder_id = ? AND files.deleted = 0
    GROUP BY kind
  `).all(folderId) as Array<{ kind: string; c: number }>;
  const tagCounts: Record<string, number> = {};
  for (const r of tagCountsRaw) tagCounts[r.kind] = r.c;

  return {
    totalFiles: totals.files,
    totalLines: totals.total,
    totalCode: totals.code,
    totalComment: totals.comment,
    totalBlank: totals.blank,
    totalBlockComment: totals.blockComment,
    byLang,
    tagCounts,
  };
}

export function getTree(folderId: number): DirNode {
  const db = getDb();
  const rows = db.prepare(`
    SELECT rel_path AS relPath, total, code, comment, blank
    FROM files WHERE folder_id = ? AND deleted = 0
  `).all(folderId) as Array<{ relPath: string; total: number; code: number; comment: number; blank: number }>;

  const root: DirNode = { name: '/', path: '', isDir: true, total: 0, code: 0, comment: 0, blank: 0, files: 0, children: [] };
  const dirMap = new Map<string, DirNode>();
  dirMap.set('', root);

  function getDir(p: string): DirNode {
    let n = dirMap.get(p);
    if (n) return n;
    const segs = p.split('/');
    const parentPath = segs.slice(0, -1).join('/');
    const parent = getDir(parentPath);
    n = { name: segs[segs.length - 1], path: p, isDir: true, total: 0, code: 0, comment: 0, blank: 0, files: 0, children: [] };
    parent.children!.push(n);
    dirMap.set(p, n);
    return n;
  }

  for (const r of rows) {
    const segs = r.relPath.split('/');
    const fileName = segs.pop()!;
    const dirPath = segs.join('/');
    const dir = getDir(dirPath);
    dir.children!.push({
      name: fileName, path: r.relPath, isDir: false,
      total: r.total, code: r.code, comment: r.comment, blank: r.blank, files: 1,
    });
  }

  function aggregate(n: DirNode): void {
    if (!n.isDir) return;
    let t = 0, c = 0, cm = 0, b = 0, files = 0;
    for (const ch of n.children!) {
      aggregate(ch);
      t += ch.total; c += ch.code; cm += ch.comment; b += ch.blank;
      files += ch.isDir ? ch.files : 1;
    }
    n.total = t; n.code = c; n.comment = cm; n.blank = b; n.files = files;
    n.children!.sort((a, b) => (b.isDir ? 1 : 0) - (a.isDir ? 1 : 0) || b.total - a.total);
  }
  aggregate(root);
  return root;
}

export function getTopFiles(folderId: number, limit = 50, sortBy: TopFileSortKey = 'total'): TopFile[] {
  const db = getDb();
  const orderColumn = sortBy === 'size' ? 'size' : 'total';
  return db.prepare(`
    SELECT rel_path AS relPath, total, code, size, lang
    FROM files WHERE folder_id = ? AND deleted = 0
    ORDER BY ${orderColumn} DESC LIMIT ?
  `).all(folderId, limit) as TopFile[];
}

export function getTopFunctions(folderId: number, limit = 50): TopFunction[] {
  const db = getDb();
  return db.prepare(`
    SELECT files.rel_path AS relPath, functions.name, functions.start_line AS startLine,
           functions.end_line AS endLine, functions.length
    FROM functions JOIN files ON functions.file_id = files.id
    WHERE files.folder_id = ? AND files.deleted = 0
    ORDER BY functions.length DESC LIMIT ?
  `).all(folderId, limit) as TopFunction[];
}

export function getTags(folderId: number, kind?: string): Array<TagRow & { relPath: string }> {
  const db = getDb();
  if (kind) {
    return db.prepare(`
      SELECT files.rel_path AS relPath, tags.file_id AS fileId, tags.kind, tags.line_no AS lineNo, tags.text
      FROM tags JOIN files ON tags.file_id = files.id
      WHERE files.folder_id = ? AND files.deleted = 0 AND tags.kind = ?
      ORDER BY files.rel_path, tags.line_no
    `).all(folderId, kind) as Array<TagRow & { relPath: string }>;
  }
  return db.prepare(`
    SELECT files.rel_path AS relPath, tags.file_id AS fileId, tags.kind, tags.line_no AS lineNo, tags.text
    FROM tags JOIN files ON tags.file_id = files.id
    WHERE files.folder_id = ? AND files.deleted = 0
    ORDER BY files.rel_path, tags.line_no
  `).all(folderId) as Array<TagRow & { relPath: string }>;
}

export function getFileTags(folderId: number, relPath: string): TagRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT tags.file_id AS fileId, tags.kind, tags.line_no AS lineNo, tags.text
    FROM tags JOIN files ON tags.file_id = files.id
    WHERE files.folder_id = ? AND files.rel_path = ? AND files.deleted = 0
    ORDER BY tags.line_no
  `).all(folderId, relPath) as TagRow[];
}

export function getHeatmap(folderId: number, days = 30): HeatmapBucket[] {
  const db = getDb();
  const since = Date.now() - days * 86400_000;
  const rows = db.prepare(`
    SELECT mtime, total FROM files
    WHERE folder_id = ? AND deleted = 0 AND mtime >= ?
  `).all(folderId, since) as Array<{ mtime: number; total: number }>;

  const buckets = new Map<string, { files: number; lines: number }>();
  for (const r of rows) {
    const d = new Date(r.mtime);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const b = buckets.get(key) ?? { files: 0, lines: 0 };
    b.files++; b.lines += r.total;
    buckets.set(key, b);
  }
  return Array.from(buckets.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

type DuplicateOccurrence = { relPath: string; startLine: number; endLine: number };

function duplicateSignature(occurrences: DuplicateOccurrence[]): string {
  return occurrences.map(occurrence => occurrence.relPath).join('|');
}

function sortOccurrences(occurrences: DuplicateOccurrence[]): DuplicateOccurrence[] {
  return [...occurrences].sort((left, right) => {
    if (left.relPath !== right.relPath) return left.relPath.localeCompare(right.relPath);
    if (left.startLine !== right.startLine) return left.startLine - right.startLine;
    return left.endLine - right.endLine;
  });
}

function clusterOrderValue(cluster: DuplicateCluster): string {
  return cluster.occurrences
    .map(occurrence => `${occurrence.relPath}:${String(occurrence.startLine).padStart(8, '0')}:${String(occurrence.endLine).padStart(8, '0')}`)
    .join('|');
}

function hasStableDuplicateAlignment(current: DuplicateCluster, next: DuplicateCluster): boolean {
  if (current.occurrences.length !== next.occurrences.length) return false;

  const currentBase = current.occurrences[0];
  const nextBase = next.occurrences[0];

  for (let index = 0; index < current.occurrences.length; index++) {
    const currentOccurrence = current.occurrences[index];
    const nextOccurrence = next.occurrences[index];
    if (currentOccurrence.relPath !== nextOccurrence.relPath) return false;

    const currentStartOffset = currentOccurrence.startLine - currentBase.startLine;
    const nextStartOffset = nextOccurrence.startLine - nextBase.startLine;
    const currentEndOffset = currentOccurrence.endLine - currentBase.endLine;
    const nextEndOffset = nextOccurrence.endLine - nextBase.endLine;

    if (currentStartOffset !== nextStartOffset || currentEndOffset !== nextEndOffset) return false;

    const overlaps = nextOccurrence.startLine <= currentOccurrence.endLine + 1
      && nextOccurrence.endLine >= currentOccurrence.startLine - 1;
    if (!overlaps) return false;
  }

  return true;
}

function mergeDuplicateClusters(current: DuplicateCluster, next: DuplicateCluster): DuplicateCluster {
  const occurrences = current.occurrences.map((occurrence, index) => ({
    relPath: occurrence.relPath,
    startLine: Math.min(occurrence.startLine, next.occurrences[index].startLine),
    endLine: Math.max(occurrence.endLine, next.occurrences[index].endLine),
  }));

  const lines = Math.max(...occurrences.map(occurrence => occurrence.endLine - occurrence.startLine + 1));
  return {
    hash: current.hash,
    occurrences,
    lines,
  };
}

function compactDuplicateClusters(clusters: DuplicateCluster[]): DuplicateCluster[] {
  const grouped = new Map<string, DuplicateCluster[]>();

  for (const cluster of clusters) {
    const signature = duplicateSignature(cluster.occurrences);
    const items = grouped.get(signature) ?? [];
    items.push(cluster);
    grouped.set(signature, items);
  }

  const mergedClusters: DuplicateCluster[] = [];

  for (const items of grouped.values()) {
    items.sort((left, right) => clusterOrderValue(left).localeCompare(clusterOrderValue(right)));
    let current = items[0];

    for (let index = 1; index < items.length; index++) {
      const next = items[index];
      if (hasStableDuplicateAlignment(current, next)) {
        current = mergeDuplicateClusters(current, next);
        continue;
      }

      mergedClusters.push(current);
      current = next;
    }

    mergedClusters.push(current);
  }

  return mergedClusters;
}

export function getDuplicates(folderId: number): DuplicateCluster[] {
  const db = getDb();
  const duplicateMinLines = getDuplicateMinLines(db, folderId);
  const rows = db.prepare(`
    SELECT duplicates.hash, files.rel_path AS relPath, duplicates.start_line AS startLine, duplicates.end_line AS endLine
    FROM duplicates JOIN files ON duplicates.file_id = files.id
    WHERE files.folder_id = ? AND files.deleted = 0
    ORDER BY duplicates.hash
  `).all(folderId) as Array<{ hash: string; relPath: string; startLine: number; endLine: number }>;

  const groups = new Map<string, Array<{ relPath: string; startLine: number; endLine: number }>>();
  for (const r of rows) {
    const arr = groups.get(r.hash) ?? [];
    arr.push({ relPath: r.relPath, startLine: r.startLine, endLine: r.endLine });
    groups.set(r.hash, arr);
  }
  const clusters: DuplicateCluster[] = [];
  for (const [hash, occurrences] of groups) {
    if (occurrences.length < 2) continue;
    clusters.push({ hash, occurrences: sortOccurrences(occurrences), lines: duplicateMinLines });
  }

  const compactedClusters = compactDuplicateClusters(clusters);
  compactedClusters.sort((a, b) => {
    const scoreDiff = b.occurrences.length * b.lines - a.occurrences.length * a.lines;
    if (scoreDiff !== 0) return scoreDiff;
    return b.lines - a.lines;
  });
  return compactedClusters.slice(0, 200);
}
