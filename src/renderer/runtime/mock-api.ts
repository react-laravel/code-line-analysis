/**
 * In-browser stand-in for the Tauri IPC bridge, so `npm run dev:ui` renders the
 * real application instead of a blank page.
 *
 * Installed by `runtime.ts` when — and only when — `isTauriRuntime()` is false,
 * so it can never mask a real IPC regression in the desktop build. Every member
 * of `Api` is implemented; nothing is left to throw.
 *
 * Data comes from `fixtures.ts` and is *derived*, not hand-listed: line counts,
 * tags, functions and duplicate clusters are recomputed with ports of the Rust
 * parsers (`src-tauri/src/parsers/*`), and API routes / import graph / Laravel
 * schema run through the genuine `@shared/*` builders the desktop app uses.
 * That keeps cross-screen navigation (cluster → editor line, route → source
 * file) internally consistent.
 */

import type {
  Api,
  DirNode,
  DuplicateCluster,
  FileMeta,
  FolderRow,
  FolderRules,
  FolderStats,
  GitFileInfo,
  HeatmapBucket,
  ScanProgress,
  ScanOptions,
  TagRow,
  TopFile,
  TopFileSortKey,
  TopFunction,
  TreeNodeContextMenuRequest,
} from '@shared/api';
import { DEFAULT_BLACKLIST, DEFAULT_DUPLICATE_LINES } from '@shared/api';
import { buildApiRouteOverview } from '@shared/apiRoutes';
import { buildFileRelationGraph } from '@shared/fileRelations';
import { buildLaravelSchemaGraph } from '@shared/laravelSchema';
import {
  ACME_API_PROJECT,
  ACME_CONSOLE_PROJECT,
  MOCK_FOLDERS,
  MOCK_PICKED_DIRECTORY,
  MOCK_PROJECTS_BY_FOLDER_ID,
  type MockFile,
  type MockProject,
} from './fixtures';
import {
  baseName,
  countLines,
  digest,
  findDuplicateSlices,
  findFunctions,
  langOf,
  scanTags,
  type LineCounts,
} from './mock-parsers';

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Mutable state
// ---------------------------------------------------------------------------

const folders: FolderRow[] = MOCK_FOLDERS.map(folder => ({ ...folder }));
const projectsByFolderId = new Map<number, MockProject>(
  Object.entries(MOCK_PROJECTS_BY_FOLDER_ID).map(([id, project]) => [Number(id), project]),
);
const rulesByFolderId = new Map<number, FolderRules>();
const duplicateRulesByFolderId = new Map<number, FolderRules>();
const duplicateMinLinesByFolderId = new Map<number, number>();
/** `${folderId}:${relPath}` → content written through `file.write`. */
const contentOverrides = new Map<string, string>();
const mtimeOverrides = new Map<string, number>();

let globalRules: FolderRules = { whitelist: [], blacklist: [...DEFAULT_BLACKLIST] };
let detectDuplicatesOnScan = true;
let nextFolderId = Math.max(...folders.map(folder => folder.id)) + 1;

function emptyRules(): FolderRules {
  return { whitelist: [], blacklist: [] };
}

function projectFor(folderId: number): MockProject {
  const known = projectsByFolderId.get(folderId);
  if (known) return known;
  const fallback = folderId % 2 === 0 ? ACME_CONSOLE_PROJECT : ACME_API_PROJECT;
  projectsByFolderId.set(folderId, fallback);
  return fallback;
}

interface ResolvedFile extends MockFile {
  folderId: number;
  counts: LineCounts;
  lang: string;
  size: number;
  mtime: number;
  hash: string;
}

function resolveFile(folderId: number, file: MockFile): ResolvedFile {
  const key = `${folderId}:${file.relPath}`;
  const content = contentOverrides.get(key) ?? file.content;
  const lang = langOf(file.relPath);
  const mtime = mtimeOverrides.get(key)
    ?? Date.now() - (file.lastCommitDaysAgo ?? 200) * DAY_MS;

  return {
    ...file,
    content,
    folderId,
    lang: lang?.id ?? 'Other',
    counts: countLines(content, lang),
    size: content.length,
    mtime,
    hash: digest(content),
  };
}

function filesFor(folderId: number): ResolvedFile[] {
  return projectFor(folderId).files.map(file => resolveFile(folderId, file));
}

function findFile(folderId: number, relPath: string): ResolvedFile | null {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return filesFor(folderId).find(file => file.relPath === normalized) ?? null;
}

function isTestPath(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return /(^|\/)(tests?|__tests__|spec|specs|e2e)\//.test(lower)
    || /\.(test|spec)\.[^/.]+$/.test(lower)
    || /(test|spec)\.php$/.test(lower);
}

function metaOf(file: ResolvedFile): FileMeta {
  return {
    relPath: file.relPath,
    size: file.size,
    mtime: file.mtime,
    lang: file.lang,
    total: file.counts.total,
    code: file.counts.code,
    comment: file.counts.comment,
    blank: file.counts.blank,
    blockComment: file.counts.blockComment,
    hash: file.hash,
  };
}

function sourceFilesFor(folderId: number): Array<{ relPath: string; lang: string; total: number; code: number; content: string }> {
  return filesFor(folderId).map(file => ({
    relPath: file.relPath,
    lang: file.lang,
    total: file.counts.total,
    code: file.counts.code,
    content: file.content,
  }));
}

// ---------------------------------------------------------------------------
// Derived statistics
// ---------------------------------------------------------------------------

function tagsFor(folderId: number): Array<TagRow & { relPath: string }> {
  const out: Array<TagRow & { relPath: string }> = [];
  filesFor(folderId).forEach((file, index) => {
    for (const tag of scanTags(file.content, langOf(file.relPath))) {
      out.push({ ...tag, fileId: index + 1, relPath: file.relPath });
    }
  });
  return out.sort((left, right) => left.relPath.localeCompare(right.relPath) || left.lineNo - right.lineNo);
}

function summaryFor(folderId: number): FolderStats {
  const files = filesFor(folderId);
  const byLangMap = new Map<string, { lang: string; files: number; total: number; code: number; comment: number; blank: number }>();
  const stats: FolderStats = {
    totalFiles: files.length,
    totalLines: 0,
    totalCode: 0,
    runtimeCode: 0,
    testCode: 0,
    totalComment: 0,
    totalBlank: 0,
    totalBlockComment: 0,
    byLang: [],
    tagCounts: {},
  };

  for (const file of files) {
    stats.totalLines += file.counts.total;
    stats.totalCode += file.counts.code;
    stats.totalComment += file.counts.comment;
    stats.totalBlank += file.counts.blank;
    stats.totalBlockComment += file.counts.blockComment;
    if (isTestPath(file.relPath)) stats.testCode += file.counts.code;
    else stats.runtimeCode += file.counts.code;

    const bucket = byLangMap.get(file.lang) ?? { lang: file.lang, files: 0, total: 0, code: 0, comment: 0, blank: 0 };
    bucket.files += 1;
    bucket.total += file.counts.total;
    bucket.code += file.counts.code;
    bucket.comment += file.counts.comment;
    bucket.blank += file.counts.blank;
    byLangMap.set(file.lang, bucket);
  }

  stats.byLang = Array.from(byLangMap.values()).sort((left, right) => right.total - left.total);

  for (const tag of tagsFor(folderId)) {
    stats.tagCounts[tag.kind] = (stats.tagCounts[tag.kind] ?? 0) + 1;
  }

  return stats;
}

function treeFor(folderId: number): DirNode {
  const folder = folders.find(item => item.id === folderId);
  const root: DirNode = {
    name: folder?.name ?? 'root',
    path: '',
    isDir: true,
    total: 0,
    code: 0,
    comment: 0,
    blank: 0,
    files: 0,
    children: [],
  };

  function childDir(parent: DirNode, name: string): DirNode {
    const path = parent.path ? `${parent.path}/${name}` : name;
    const existing = parent.children?.find(child => child.isDir && child.path === path);
    if (existing) return existing;
    const created: DirNode = { name, path, isDir: true, total: 0, code: 0, comment: 0, blank: 0, files: 0, children: [] };
    parent.children?.push(created);
    return created;
  }

  for (const file of filesFor(folderId)) {
    const segments = file.relPath.split('/');
    const fileName = segments.pop() ?? file.relPath;
    const chain: DirNode[] = [root];
    let cursor = root;
    for (const segment of segments) {
      cursor = childDir(cursor, segment);
      chain.push(cursor);
    }
    cursor.children?.push({
      name: fileName,
      path: file.relPath,
      isDir: false,
      total: file.counts.total,
      code: file.counts.code,
      comment: file.counts.comment,
      blank: file.counts.blank,
      files: 1,
    });
    for (const node of chain) {
      node.total += file.counts.total;
      node.code += file.counts.code;
      node.comment += file.counts.comment;
      node.blank += file.counts.blank;
      node.files += 1;
    }
  }

  function sortNode(node: DirNode): void {
    node.children?.sort((left, right) => {
      if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    node.children?.forEach(sortNode);
  }
  sortNode(root);

  return root;
}

function topFilesFor(folderId: number, limit?: number, sortBy?: TopFileSortKey): TopFile[] {
  const rows: TopFile[] = filesFor(folderId).map(file => ({
    relPath: file.relPath,
    total: file.counts.total,
    code: file.counts.code,
    size: file.size,
    lang: file.lang,
    lastCommitDate: file.lastCommitDaysAgo == null ? null : Date.now() - file.lastCommitDaysAgo * DAY_MS,
  }));

  const key: TopFileSortKey = sortBy ?? 'total';
  rows.sort((left, right) => {
    if (key === 'size') return right.size - left.size;
    if (key === 'lastCommitDate') return (right.lastCommitDate ?? 0) - (left.lastCommitDate ?? 0);
    return right.total - left.total;
  });

  return rows.slice(0, limit ?? rows.length);
}

function topFunctionsFor(folderId: number, limit?: number): TopFunction[] {
  const out: TopFunction[] = [];
  for (const file of filesFor(folderId)) {
    for (const found of findFunctions(file.content, file.relPath)) {
      out.push({ relPath: file.relPath, ...found });
    }
  }
  out.sort((left, right) => right.length - left.length || left.relPath.localeCompare(right.relPath));
  return out.slice(0, limit ?? out.length);
}

function duplicatesFor(folderId: number): DuplicateCluster[] {
  const windowSize = duplicateMinLinesByFolderId.get(folderId) ?? DEFAULT_DUPLICATE_LINES;
  const byHash = new Map<string, DuplicateCluster>();

  for (const file of filesFor(folderId)) {
    for (const slice of findDuplicateSlices(file.content, windowSize)) {
      const cluster = byHash.get(slice.hash) ?? { hash: slice.hash, occurrences: [], lines: windowSize };
      cluster.occurrences.push({ relPath: file.relPath, startLine: slice.startLine, endLine: slice.endLine });
      byHash.set(slice.hash, cluster);
    }
  }

  const clusters = Array.from(byHash.values())
    .filter(cluster => cluster.occurrences.length > 1)
    .sort((left, right) => right.occurrences.length - left.occurrences.length
      || left.occurrences[0].relPath.localeCompare(right.occurrences[0].relPath)
      || left.occurrences[0].startLine - right.occurrences[0].startLine);

  // A copied block N lines longer than the window produces one shingle per
  // offset. Absorb every shingle that overlaps an already-kept cluster in all
  // of the same files, widening that cluster's spans, so the lens shows one
  // entry per copied block rather than a stack of near-identical ones.
  const kept: DuplicateCluster[] = [];

  for (const cluster of clusters) {
    const target = kept.find(candidate => cluster.occurrences.every(occurrence => candidate.occurrences.some(
      existing => existing.relPath === occurrence.relPath
        && existing.startLine <= occurrence.endLine
        && existing.endLine >= occurrence.startLine,
    )));

    if (!target) {
      kept.push({ ...cluster, occurrences: cluster.occurrences.map(item => ({ ...item })) });
      continue;
    }

    for (const occurrence of cluster.occurrences) {
      const existing = target.occurrences.find(
        item => item.relPath === occurrence.relPath
          && item.startLine <= occurrence.endLine
          && item.endLine >= occurrence.startLine,
      );
      if (!existing) continue;
      existing.startLine = Math.min(existing.startLine, occurrence.startLine);
      existing.endLine = Math.max(existing.endLine, occurrence.endLine);
    }
  }

  for (const cluster of kept) {
    cluster.lines = Math.max(...cluster.occurrences.map(item => item.endLine - item.startLine + 1));
  }

  return kept.sort((left, right) => right.lines - left.lines
    || right.occurrences.length - left.occurrences.length);
}

/** Deterministic per-folder pseudo-random source, so charts are stable. */
function seededRandom(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function heatmapFor(folderId: number, days?: number): HeatmapBucket[] {
  const span = Math.max(1, days ?? 365);
  const random = seededRandom(folderId + 17);
  const out: HeatmapBucket[] = [];
  const today = new Date();

  for (let offset = span - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getTime() - offset * DAY_MS);
    const roll = random();
    if (roll < 0.42) continue; // quiet day
    const weekday = date.getDay();
    const weight = weekday === 0 || weekday === 6 ? 0.35 : 1;
    const files = Math.max(1, Math.round(random() * 9 * weight));
    out.push({
      date: date.toISOString().slice(0, 10),
      files,
      lines: Math.round(files * (20 + random() * 160)),
    });
  }

  return out;
}

function gitFileInfoFor(folderId: number, relPath: string): GitFileInfo | null {
  const file = findFile(folderId, relPath);
  if (!file || file.lastCommitDaysAgo == null) return null;
  const project = projectFor(folderId);
  const random = seededRandom(digest(relPath).length + relPath.length + folderId);
  const primary = project.authors[relPath.length % project.authors.length];
  const secondary = project.authors[(relPath.length + 1) % project.authors.length];

  return {
    lastSha: digest(`${relPath}:${file.hash}`).slice(0, 12),
    lastAuthor: primary,
    lastDate: Date.now() - file.lastCommitDaysAgo * DAY_MS,
    topAuthors: [
      { author: primary, lines: Math.max(1, Math.round(file.counts.code * (0.5 + random() * 0.4))) },
      { author: secondary, lines: Math.max(1, Math.round(file.counts.code * 0.3)) },
    ],
  };
}

// ---------------------------------------------------------------------------
// Scan lifecycle
// ---------------------------------------------------------------------------

const SCAN_TICK_MS = 70;
const SCAN_TICKS_PER_PHASE = 12;

const progressListeners = new Set<(progress: ScanProgress) => void>();

interface ActiveScan {
  timer: number;
  finish: (cancelled: boolean) => void;
}

let activeScan: ActiveScan | null = null;
let scanQueue: Promise<void> = Promise.resolve();

function emitProgress(progress: ScanProgress): void {
  for (const listener of [...progressListeners]) listener(progress);
}

function buildScanSteps(folderId: number, files: ResolvedFile[]): ScanProgress[] {
  const total = Math.max(1, files.length);
  const steps: ScanProgress[] = [];

  for (const phase of ['walking', 'parsing', 'persisting'] as const) {
    const ticks = Math.min(total, SCAN_TICKS_PER_PHASE);
    for (let tick = 1; tick <= ticks; tick += 1) {
      const done = Math.round((total * tick) / ticks);
      const step: ScanProgress = { folderId, phase, total, done };
      const current = files[Math.min(done, files.length) - 1]?.relPath;
      if (current) step.current = current;
      if (phase === 'parsing') step.cacheHits = Math.floor(done * 0.4);
      steps.push(step);
    }
  }

  // `done` is emitted by the runner itself, so cancelling mid-way still ends
  // the job with exactly one terminal event.
  return steps;
}

function stopActiveScan(cancelled = false): void {
  if (!activeScan) return;
  const { timer, finish } = activeScan;
  activeScan = null;
  window.clearInterval(timer);
  finish(cancelled);
}

function performMockScan(folderId: number, opts?: ScanOptions): Promise<FolderStats> {
  const files = filesFor(folderId);
  const steps = buildScanSteps(folderId, files);
  const total = Math.max(1, files.length);

  return new Promise<FolderStats>((resolve, reject) => {
    let index = 0;
    const settle = (cancelled: boolean) => {
      emitProgress({ folderId, requestId: opts?.requestId, phase: 'done', outcome: cancelled ? 'cancelled' : 'success', total, done: total });
      if (cancelled) { reject(new Error('Scan cancelled')); return; }
      resolve(summaryFor(folderId));
    };

    const timer = window.setInterval(() => {
      const step = steps[index];
      index += 1;
      if (!step) {
        stopActiveScan();
        return;
      }
      emitProgress({ ...step, requestId: opts?.requestId });
    }, SCAN_TICK_MS);

    activeScan = { timer, finish: settle };
  });
}

function runScan(folderId: number, opts?: ScanOptions): Promise<FolderStats> {
  const next = scanQueue.then(() => performMockScan(folderId, opts));
  scanQueue = next.then(() => undefined, () => undefined);
  return next;
}

// ---------------------------------------------------------------------------
// The API surface
// ---------------------------------------------------------------------------

function folderName(rootPath: string): string {
  return baseName(rootPath.replace(/\/+$/, '')) || rootPath;
}

function addFolder(rootPath: string): FolderRow {
  const existing = folders.find(folder => folder.rootPath === rootPath);
  if (existing) return { ...existing };
  const folder: FolderRow = {
    id: nextFolderId,
    rootPath,
    name: folderName(rootPath),
    createdAt: Date.now(),
    isAvailable: true,
  };
  nextFolderId += 1;
  folders.push(folder);
  return { ...folder };
}

function requireFolder(id: number): FolderRow {
  const folder = folders.find(item => item.id === id);
  if (!folder) throw new Error(`Folder ${id} does not exist`);
  return folder;
}

export function createMockApi(): Api {
  return {
    runtime: {
      mode: 'mock',
      supportsNativeFolderSelection: false,
      supportsFileWrite: true,
      supportsExternalLinks: false,
    },
    folders: {
      add: async rootPath => addFolder(rootPath),
      addGitRepositories: async rootPath => [
        addFolder(`${rootPath.replace(/\/+$/, '')}/packages/core`),
        addFolder(`${rootPath.replace(/\/+$/, '')}/packages/web`),
      ],
      list: async () => [...folders]
        .sort((left, right) => right.createdAt - left.createdAt)
        .map(folder => ({ ...folder })),
      relocate: async (id, rootPath) => {
        const folder = requireFolder(id);
        folder.rootPath = rootPath;
        folder.name = folderName(rootPath);
        folder.isAvailable = true;
        return { ...folder };
      },
      remove: async id => {
        const index = folders.findIndex(folder => folder.id === id);
        if (index >= 0) folders.splice(index, 1);
      },
      getRules: async id => ({ ...(rulesByFolderId.get(id) ?? emptyRules()) }),
      setRules: async (id, rules) => {
        const next: FolderRules = {
          whitelist: [...(rules.whitelist ?? [])],
          blacklist: [...(rules.blacklist ?? [])],
        };
        rulesByFolderId.set(id, next);
        return { ...next };
      },
      getDuplicateMinLines: async id => duplicateMinLinesByFolderId.get(id) ?? DEFAULT_DUPLICATE_LINES,
      setDuplicateMinLines: async (id, count) => {
        duplicateMinLinesByFolderId.set(id, count);
        void runScan(id).catch(() => undefined);
      },
      getDuplicateRules: async id => ({ ...(duplicateRulesByFolderId.get(id) ?? emptyRules()) }),
      setDuplicateRules: async (id, rules) => {
        const next: FolderRules = {
          whitelist: [...(rules.whitelist ?? [])],
          blacklist: [...(rules.blacklist ?? [])],
        };
        duplicateRulesByFolderId.set(id, next);
        return { ...next };
      },
      pickDirectory: async () => MOCK_PICKED_DIRECTORY,
    },
    scan: {
      run: (folderId, opts) => {
        if (opts?.duplicateMinLines != null) duplicateMinLinesByFolderId.set(folderId, opts.duplicateMinLines);
        if (opts?.duplicateRules) duplicateRulesByFolderId.set(folderId, opts.duplicateRules);
        return runScan(folderId, opts);
      },
      cancel: async () => {
        stopActiveScan(true);
      },
      onProgress: callback => {
        progressListeners.add(callback);
        return () => {
          progressListeners.delete(callback);
        };
      },
    },
    settings: {
      getDetectDuplicates: async () => detectDuplicatesOnScan,
      setDetectDuplicates: async enabled => { detectDuplicatesOnScan = enabled; },
      getGlobalRules: async () => ({ ...globalRules }),
      setGlobalRules: async rules => {
        globalRules = {
          whitelist: [...(rules.whitelist ?? [])],
          blacklist: [...(rules.blacklist ?? [])],
        };
        return { ...globalRules };
      },
    },
    stats: {
      summary: async folderId => summaryFor(folderId),
      tree: async (folderId, expandedPaths) => {
        const tree = treeFor(folderId);
        if (expandedPaths) {
          const expanded = new Set(expandedPaths);
          const trim = (node: DirNode): void => {
            node.children = node.children?.filter(child => child.isDir || node.path === '' || expanded.has(node.path));
            node.children?.filter(child => child.isDir).forEach(trim);
          };
          trim(tree);
        }
        return tree;
      },
      filesPage: async (folderId, offset = 0, limit = 1000) => {
        const rows = topFilesFor(folderId).sort((a,b) => a.relPath.localeCompare(b.relPath));
        return { rows: rows.slice(offset, offset + limit), total: rows.length, revision: 0 };
      },
      fileDates: async folderId => ({ dates: Object.fromEntries(topFilesFor(folderId).filter(row => row.lastCommitDate != null).map(row => [row.relPath, row.lastCommitDate!])), revision: 0 }),
      topFiles: async (folderId, limit, sortBy) => topFilesFor(folderId, limit, sortBy),
      topFunctions: async (folderId, limit) => topFunctionsFor(folderId, limit),
      apiRoutes: async folderId => buildApiRouteOverview(sourceFilesFor(folderId)),
      fileRelations: async folderId => buildFileRelationGraph(sourceFilesFor(folderId)),
      laravelSchema: async folderId => buildLaravelSchemaGraph(sourceFilesFor(folderId)),
      tags: async (folderId, kind) => {
        const all = tagsFor(folderId);
        return kind ? all.filter(tag => tag.kind === kind) : all;
      },
      fileTags: async (folderId, relPath) => {
        const file = findFile(folderId, relPath);
        if (!file) return [];
        return scanTags(file.content, langOf(file.relPath)).map(tag => ({ ...tag, fileId: 0 }));
      },
      heatmap: async (folderId, days) => heatmapFor(folderId, days),
      duplicates: async folderId => duplicatesFor(folderId),
    },
    file: {
      read: async (folderId, relPath) => {
        const file = findFile(folderId, relPath);
        if (!file) throw new Error(`File not found: ${relPath}`);
        return { content: file.content, meta: metaOf(file) };
      },
      write: async (folderId, relPath, content, expectedHash) => {
        const file = findFile(folderId, relPath);
        if (!file) throw new Error(`File not found: ${relPath}`);
        if (metaOf(file).hash !== expectedHash) throw new Error("File changed on disk; reload before saving");
        const key = `${folderId}:${file.relPath}`;
        contentOverrides.set(key, content);
        mtimeOverrides.set(key, Date.now());
        const updated = findFile(folderId, relPath);
        if (!updated) throw new Error(`File not found: ${relPath}`);
        return metaOf(updated);
      },
      meta: async (folderId, relPath) => {
        const file = findFile(folderId, relPath);
        return file ? metaOf(file) : null;
      },
    },
    git: {
      cancelFileInfo: async () => {},
      fileInfo: async (folderId, relPath) => gitFileInfoFor(folderId, relPath),
      repoInfo: async folderId => {
        const info = projectFor(folderId).repoInfo;
        return info ? { ...info } : null;
      },
    },
    system: {
      // Both of these are native shell integrations with no browser equivalent;
      // the desktop build keeps the real behaviour.
      showTreeNodeContextMenu: async (request: TreeNodeContextMenuRequest) => {
        console.info('[mock-api] system.showTreeNodeContextMenu', request.relPath, request.labels);
      },
      openExternal: async url => {
        console.info('[mock-api] system.openExternal', url);
      },
    },
  };
}
