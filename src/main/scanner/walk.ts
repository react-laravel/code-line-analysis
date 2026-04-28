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

const DEFAULT_BLACKLIST = [
  'node_modules',
  'vendor',
  'dist',
  'build',
  '.git',
  '.idea',
  '.vscode',
  '*.min.js',
  '*.min.css',
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

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
  const blacklist = [...DEFAULT_BLACKLIST, ...opts.blacklist.filter(Boolean)];

  const patterns = opts.whitelist.length ? opts.whitelist : ['**/*'];

  const matches = await fg(patterns, {
    cwd: root,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    suppressErrors: true,
    ignore: blacklist.flatMap(p => p.includes('/') ? [p] : [p, `**/${p}`, `**/${p}/**`]),
  });

  const gi = loadGitignore(root);
  const filtered = gi.filter(matches);
  return filtered
    .map(p => p.split(path.sep).join('/'))
    .filter(p => !isExcludedAssetPath(p));
}

export { DEFAULT_BLACKLIST };
