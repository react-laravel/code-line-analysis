import simpleGit from 'simple-git';
import path from 'node:path';
import fs from 'node:fs';
import type { GitFileInfo } from '../shared/api';

const cache = new Map<string, GitFileInfo>();

export async function getGitFileInfo(root: string, relPath: string): Promise<GitFileInfo | null> {
  if (!fs.existsSync(path.join(root, '.git'))) return null;
  const key = `${root}::${relPath}`;
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const git = simpleGit(root);
    const log = await git.log({ file: relPath, n: 1 });
    const last = log.latest;
    let topAuthors: Array<{ author: string; lines: number }> = [];
    try {
      const blame = await git.raw(['blame', '--line-porcelain', relPath]);
      const counts = new Map<string, number>();
      for (const line of blame.split('\n')) {
        if (line.startsWith('author ')) {
          const a = line.slice(7);
          counts.set(a, (counts.get(a) ?? 0) + 1);
        }
      }
      topAuthors = Array.from(counts.entries())
        .map(([author, lines]) => ({ author, lines }))
        .sort((a, b) => b.lines - a.lines)
        .slice(0, 5);
    } catch { /* blame may fail */ }
    const info: GitFileInfo = {
      lastSha: last?.hash ?? null,
      lastAuthor: last?.author_name ?? null,
      lastDate: last ? new Date(last.date).getTime() : null,
      topAuthors,
    };
    cache.set(key, info);
    return info;
  } catch {
    return null;
  }
}

export function clearGitCache(): void { cache.clear(); }
