import simpleGit from 'simple-git';
import type { GitFileInfo, GitRepoInfo, HeatmapBucket } from '../shared/api';

const fileCache = new Map<string, GitFileInfo>();
const repoCache = new Map<string, GitRepoInfo>();

async function ensureGitRepo(root: string) {
  const git = simpleGit(root);
  const isRepo = await git.checkIsRepo();
  return isRepo ? git : null;
}

export async function getGitFileInfo(root: string, relPath: string): Promise<GitFileInfo | null> {
  const key = `${root}::${relPath}`;
  const cached = fileCache.get(key);
  if (cached) return cached;
  try {
    const git = await ensureGitRepo(root);
    if (!git) return null;
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
    fileCache.set(key, info);
    return info;
  } catch {
    return null;
  }
}

function normalizeRemoteOriginWebUrl(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;

  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\.git$/i, '');

  const scpMatch = trimmed.match(/^git@([^:]+):(.+)$/i);
  if (scpMatch) return `https://${scpMatch[1]}/${scpMatch[2].replace(/\.git$/i, '')}`;

  const sshMatch = trimmed.match(/^(?:ssh|git):\/\/(?:[^@]+@)?([^/]+)\/(.+)$/i);
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2].replace(/\.git$/i, '')}`;

  return null;
}

export async function getGitRepoInfo(root: string): Promise<GitRepoInfo | null> {
  const cached = repoCache.get(root);
  if (cached) return cached;

  try {
    const git = await ensureGitRepo(root);
    if (!git) return null;

    const [log, remotes] = await Promise.all([
      git.log({ n: 1 }),
      git.getRemotes(true),
    ]);
    const latest = log.latest;
    const origin = remotes.find(remote => remote.name === 'origin');
    const remoteOriginUrl = origin?.refs.fetch ?? origin?.refs.push ?? null;
    const info: GitRepoInfo = {
      lastCommitSha: latest?.hash ?? null,
      lastCommitDate: latest ? new Date(latest.date).getTime() : null,
      remoteOriginUrl,
      remoteOriginWebUrl: normalizeRemoteOriginWebUrl(remoteOriginUrl),
    };
    repoCache.set(root, info);
    return info;
  } catch {
    return null;
  }
}

export async function getGitHeatmap(root: string, days = 30): Promise<HeatmapBucket[]> {
  try {
    const git = await ensureGitRepo(root);
    if (!git) return [];

    const raw = await git.raw([
      'log',
      `--since=${Math.max(1, Math.floor(days))}.days`,
      '--date=short',
      '--pretty=format:__CLA_DATE__%ad',
      '--numstat',
      '--',
    ]);

    const buckets = new Map<string, { files: Set<string>; lines: number }>();
    let currentDate = '';

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      if (line.startsWith('__CLA_DATE__')) {
        currentDate = line.slice('__CLA_DATE__'.length).trim();
        if (!buckets.has(currentDate)) buckets.set(currentDate, { files: new Set<string>(), lines: 0 });
        continue;
      }

      if (!currentDate) continue;
      const match = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
      if (!match) continue;

      const additions = match[1] === '-' ? 0 : Number(match[1]);
      const deletions = match[2] === '-' ? 0 : Number(match[2]);
      const filePath = match[3];
      const bucket = buckets.get(currentDate);
      if (!bucket) continue;

      bucket.files.add(filePath);
      bucket.lines += additions + deletions;
    }

    return Array.from(buckets.entries())
      .map(([date, bucket]) => ({ date, files: bucket.files.size, lines: bucket.lines }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

export function clearGitCache(): void {
  fileCache.clear();
  repoCache.clear();
}
