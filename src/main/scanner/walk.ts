import fg from 'fast-glob';
import ignore, { Ignore } from 'ignore';
import path from 'node:path';
import fs from 'node:fs';
import { isExcludedAssetPath } from './fileFilters';

export interface WalkOptions {
  root: string;
  whitelist: string[];
  blacklist: string[];
}

function normalizeWalkPattern(pattern: string): { normalized: string; directoryLike: boolean } {
  const slashed = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
  const directoryLike = slashed.endsWith('/');
  return {
    normalized: slashed.replace(/\/+$|^\/$/g, ''),
    directoryLike,
  };
}

function expandWhitelistPattern(pattern: string): string[] {
  const { normalized, directoryLike } = normalizeWalkPattern(pattern);
  if (!normalized) return [];
  if (!directoryLike) return [normalized];
  return [`${normalized}/**`];
}

function expandBlacklistPattern(pattern: string): string[] {
  const { normalized } = normalizeWalkPattern(pattern);
  if (!normalized) return [];
  if (normalized.includes('/')) return [normalized, `${normalized}/**`];
  return [normalized, `**/${normalized}`, `**/${normalized}/**`];
}

function loadGitignore(root: string): Ignore {
  const ig = ignore();
  const gi = path.join(root, '.gitignore');
  if (fs.existsSync(gi)) {
    try {
      ig.add(fs.readFileSync(gi, 'utf-8'));
    } catch { /* ignore */ }
  }
  return ig;
}

export async function walkFolder(opts: WalkOptions): Promise<string[]> {
  const { root } = opts;
  const blacklist = opts.blacklist.flatMap(expandBlacklistPattern);

  const patterns = opts.whitelist.length ? opts.whitelist.flatMap(expandWhitelistPattern) : ['**/*'];

  const matches = await fg(patterns, {
    cwd: root,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    suppressErrors: true,
    ignore: blacklist,
  });

  const gi = loadGitignore(root);
  const filtered = gi.filter(matches);
  return filtered
    .map(p => p.split(path.sep).join('/'))
    .filter(p => !isExcludedAssetPath(p));
}
