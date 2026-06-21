import type {
  Api,
  ApiRouteOverview,
  DirNode,
  DuplicateCluster,
  FileMeta,
  FileRelationGraph,
  FolderRow,
  FolderRules,
  FolderStats,
  HeatmapBucket,
  LaravelSchemaGraph,
  ScanOptions,
  ScanProgress,
  TagRow,
  TopFile,
  TopFunction,
} from '../../shared/api';
import { DEFAULT_BLACKLIST, DEFAULT_DUPLICATE_LINES } from '../../shared/api';
import { buildApiRouteOverview } from '../../shared/apiRoutes';
import { buildFileRelationGraph } from '../../shared/fileRelations';
import { buildLaravelSchemaGraph } from '../../shared/laravelSchema';
import { analyzeBrowserFolder, type BrowserAnalyzedFile, type BrowserFolderAnalysis, type BrowserSourceFile } from './analyzer';

const GLOBAL_RULES_STORAGE_KEY = 'code-line-analysis:web-global-rules';
const WEB_IMPORT_TOKEN_PREFIX = 'web-import://';

interface WindowWithDirectoryPicker extends Window {
  showDirectoryPicker?: () => Promise<any>;
}

interface DataTransferItemWithWebkitEntry extends DataTransferItem {
  webkitGetAsEntry?: () => WebkitFileSystemEntry | null;
}

interface WebkitFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

interface WebkitFileSystemFileEntry extends WebkitFileSystemEntry {
  file: (successCallback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void;
}

interface WebkitFileSystemDirectoryEntry extends WebkitFileSystemEntry {
  createReader: () => WebkitFileSystemDirectoryReader;
}

interface WebkitFileSystemDirectoryReader {
  readEntries: (successCallback: (entries: WebkitFileSystemEntry[]) => void, errorCallback?: (error: DOMException) => void) => void;
}

interface StagedImportFile {
  relPath: string;
  file: File;
}

interface StagedImport {
  name: string;
  rootLabel: string;
  files: StagedImportFile[];
}

interface BrowserFolderFile {
  relPath: string;
  file: File;
  contentOverride?: string;
}

interface BrowserFolderState {
  row: FolderRow;
  files: BrowserFolderFile[];
  rules: FolderRules;
  duplicateRules: FolderRules;
  duplicateMinLines: number;
  analysis: BrowserFolderAnalysis | null;
  lastScanOptions: ScanOptions;
}

const stagedImports = new Map<string, StagedImport>();
const folders = new Map<number, BrowserFolderState>();
const scanListeners = new Set<(progress: ScanProgress) => void>();

let nextFolderId = 1;
let importCounter = 1;
let scanCancelled = false;

function cloneRules(rules: FolderRules): FolderRules {
  return {
    whitelist: [...rules.whitelist],
    blacklist: [...rules.blacklist],
  };
}

function normalizeRules(value: FolderRules | null | undefined, fallbackBlacklist: readonly string[] = []): FolderRules {
  const whitelist = Array.isArray(value?.whitelist)
    ? Array.from(new Set(value.whitelist.map(pattern => pattern.trim()).filter(Boolean)))
    : [];
  const blacklistSource = Array.isArray(value?.blacklist) ? value.blacklist : fallbackBlacklist;
  const blacklist = Array.from(new Set(Array.from(blacklistSource).map(pattern => pattern.trim()).filter(Boolean)));
  return { whitelist, blacklist };
}

function normalizeRelPath(relPath: string): string {
  return relPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function emitProgress(progress: ScanProgress): void {
  scanListeners.forEach(listener => listener(progress));
}

function getGlobalRules(): FolderRules {
  try {
    const raw = window.localStorage.getItem(GLOBAL_RULES_STORAGE_KEY);
    if (!raw) return normalizeRules(undefined, DEFAULT_BLACKLIST);
    return normalizeRules(JSON.parse(raw) as FolderRules, DEFAULT_BLACKLIST);
  } catch {
    return normalizeRules(undefined, DEFAULT_BLACKLIST);
  }
}

function setGlobalRulesStorage(rules: FolderRules): FolderRules {
  const normalized = normalizeRules(rules, DEFAULT_BLACKLIST);
  try {
    window.localStorage.setItem(GLOBAL_RULES_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage failures and keep the in-memory value derived from the setter.
  }
  return normalized;
}

function emptySummary(): FolderStats {
  return {
    totalFiles: 0,
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
}

function emptyTree(): DirNode {
  return { name: '/', path: '', isDir: true, total: 0, code: 0, comment: 0, blank: 0, files: 0, children: [] };
}

function emptyFileRelations(): FileRelationGraph {
  return { nodes: [], edges: [], scannedFiles: 0, connectedFiles: 0, unresolvedCount: 0 };
}

function emptyApiRoutes(): ApiRouteOverview {
  return { frameworks: [], routes: [], laravelRouteFiles: 0, nextRouteFiles: 0, warnings: [] };
}

function emptyLaravelSchema(): LaravelSchemaGraph {
  return { isLaravel: false, detectedBy: [], tables: [], relations: [], migrationCount: 0, modelCount: 0, unresolvedModelRelations: 0, warnings: [] };
}

function filesForSharedAnalysis(folderId: number) {
  return (folders.get(folderId)?.analysis?.files ?? []).map(file => ({
    relPath: file.relPath,
    lang: file.meta.lang,
    total: file.meta.total,
    code: file.meta.code,
    content: file.content,
  }));
}

function getFolderState(folderId: number): BrowserFolderState {
  const folder = folders.get(folderId);
  if (!folder) throw new Error(`Folder ${folderId} was not found.`);
  return folder;
}

function effectiveRules(folder: BrowserFolderState): FolderRules {
  const globalRules = getGlobalRules();
  return {
    whitelist: folder.rules.whitelist.length > 0 ? [...folder.rules.whitelist] : [...globalRules.whitelist],
    blacklist: [...globalRules.blacklist, ...folder.rules.blacklist],
  };
}

function duplicateRulesFor(folder: BrowserFolderState, scanOptions: ScanOptions): FolderRules | undefined {
  if (scanOptions.duplicateRules) return cloneRules(scanOptions.duplicateRules);
  return cloneRules(folder.duplicateRules);
}

function sourceFilesFor(folder: BrowserFolderState): BrowserSourceFile[] {
  return folder.files.map(file => ({
    relPath: file.relPath,
    size: file.contentOverride == null ? file.file.size : new Blob([file.contentOverride]).size,
    mtime: file.contentOverride == null ? file.file.lastModified : Date.now(),
    readText: async () => file.contentOverride ?? file.file.text(),
  }));
}

function findAnalyzedFile(folderId: number, relPath: string): BrowserAnalyzedFile | null {
  const folder = folders.get(folderId);
  if (!folder?.analysis) return null;
  return folder.analysis.files.find(file => file.relPath === normalizeRelPath(relPath)) ?? null;
}

async function rerunFolderAnalysis(folderId: number, overrides?: ScanOptions): Promise<FolderStats> {
  const folder = getFolderState(folderId);
  const nextOptions: ScanOptions = { ...folder.lastScanOptions, ...overrides };
  folder.lastScanOptions = nextOptions;
  scanCancelled = false;

  const analysis = await analyzeBrowserFolder({
    folderId,
    sourceFiles: sourceFilesFor(folder),
    rules: effectiveRules(folder),
    duplicateRules: duplicateRulesFor(folder, nextOptions),
    duplicateMinLines: Math.max(3, Math.floor(nextOptions.duplicateMinLines ?? folder.duplicateMinLines ?? DEFAULT_DUPLICATE_LINES)),
    detectDuplicates: nextOptions.detectDuplicates ?? true,
    onProgress: emitProgress,
    shouldCancel: () => scanCancelled,
  });

  folder.analysis = analysis;
  return analysis.summary;
}

function readDirectoryEntry(entry: WebkitFileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readAllDirectoryEntries(reader: WebkitFileSystemDirectoryReader): Promise<WebkitFileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const allEntries: WebkitFileSystemEntry[] = [];

    function pump() {
      reader.readEntries(entries => {
        if (entries.length === 0) {
          resolve(allEntries);
          return;
        }

        allEntries.push(...entries);
        pump();
      }, reject);
    }

    pump();
  });
}

async function collectFromWebkitEntry(entry: WebkitFileSystemEntry, prefix = ''): Promise<StagedImportFile[]> {
  if (entry.isFile) {
    const file = await readDirectoryEntry(entry as WebkitFileSystemFileEntry);
    return [{ relPath: normalizeRelPath(`${prefix}${entry.name}`), file }];
  }

  if (!entry.isDirectory) return [];
  const directory = entry as WebkitFileSystemDirectoryEntry;
  const entries = await readAllDirectoryEntries(directory.createReader());
  const nested = await Promise.all(entries.map(child => collectFromWebkitEntry(child, `${prefix}${entry.name}/`)));
  return nested.flat();
}

async function collectFromDirectoryHandle(handle: any, prefix = ''): Promise<StagedImportFile[]> {
  const out: StagedImportFile[] = [];

  for await (const [name, child] of handle.entries()) {
    if (child.kind === 'file') {
      const file = await child.getFile();
      out.push({ relPath: normalizeRelPath(`${prefix}${name}`), file });
      continue;
    }

    if (child.kind === 'directory') {
      out.push(...await collectFromDirectoryHandle(child, `${prefix}${name}/`));
    }
  }

  return out;
}

function getFolderNameFromRelativePath(relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  const slash = normalized.indexOf('/');
  return slash >= 0 ? normalized.slice(0, slash) : normalized;
}

function collectFromFileList(fileList: FileList): StagedImportFile[] {
  return Array.from(fileList)
    .map(file => {
      const relativePath = typeof file.webkitRelativePath === 'string' && file.webkitRelativePath !== ''
        ? file.webkitRelativePath
        : file.name;
      return { relPath: normalizeRelPath(relativePath), file };
    })
    .filter(file => file.relPath !== '');
}

function inferImportName(files: StagedImportFile[], fallback = 'Browser Import'): string {
  if (files.length === 0) return fallback;
  const first = files[0].relPath;
  const folderName = getFolderNameFromRelativePath(first);
  return folderName || fallback;
}

function stageImport(files: StagedImportFile[], preferredName?: string): string {
  const normalizedFiles = files
    .map(file => ({ relPath: normalizeRelPath(file.relPath), file: file.file }))
    .filter(file => file.relPath !== '');
  const name = preferredName?.trim() || inferImportName(normalizedFiles);
  const token = `${WEB_IMPORT_TOKEN_PREFIX}${importCounter++}`;
  stagedImports.set(token, {
    name,
    rootLabel: `browser://${name}`,
    files: normalizedFiles,
  });
  return token;
}

function openDirectoryPickerFallback(): Promise<string | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);

    const cleanup = () => {
      window.setTimeout(() => input.remove(), 0);
    };

    input.addEventListener('change', () => {
      try {
        if (!input.files || input.files.length === 0) {
          resolve(null);
          return;
        }

        const files = collectFromFileList(input.files);
        resolve(stageImport(files));
      } finally {
        cleanup();
      }
    }, { once: true });

    input.click();
  });
}

export async function stageBrowserDropImport(dataTransfer: DataTransfer): Promise<string | null> {
  const items = Array.from(dataTransfer.items ?? []);
  const webkitEntries = items
    .map(item => (item as DataTransferItemWithWebkitEntry).webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is WebkitFileSystemEntry => entry != null);

  if (webkitEntries.length > 0) {
    const preferredName = webkitEntries[0].name || undefined;
    const files = (await Promise.all(webkitEntries.map(entry => collectFromWebkitEntry(entry)))).flat();
    return files.length > 0 ? stageImport(files, preferredName) : null;
  }

  if (dataTransfer.files.length > 0) {
    return stageImport(collectFromFileList(dataTransfer.files));
  }

  return null;
}

export function createBrowserApi(): Api {
  return {
    runtime: {
      mode: 'web',
      supportsNativeFolderSelection: false,
      supportsDirectoryDropImport: true,
      supportsFileWrite: true,
      supportsExternalLinks: true,
    },
    folders: {
      add: async (rootPath) => {
        const staged = stagedImports.get(rootPath);
        if (!staged) {
          throw new Error('Web mode requires selecting or dropping a folder through the browser UI.');
        }

        stagedImports.delete(rootPath);
        const row: FolderRow = {
          id: nextFolderId++,
          rootPath: staged.rootLabel,
          name: staged.name,
          createdAt: Date.now(),
        };

        folders.set(row.id, {
          row,
          files: staged.files.map(file => ({ relPath: file.relPath, file: file.file })),
          rules: { whitelist: [], blacklist: [] },
          duplicateRules: { whitelist: [], blacklist: [] },
          duplicateMinLines: DEFAULT_DUPLICATE_LINES,
          analysis: null,
          lastScanOptions: { detectDuplicates: true, duplicateMinLines: DEFAULT_DUPLICATE_LINES },
        });

        return row;
      },
      addGitRepositories: async () => {
        throw new Error('Git repository discovery is only available in the desktop app.');
      },
      list: async () => Array.from(folders.values()).map(folder => folder.row),
      remove: async (id) => {
        folders.delete(id);
      },
      getRules: async (id) => cloneRules(getFolderState(id).rules),
      setRules: async (id, rules) => {
        const folder = getFolderState(id);
        folder.rules = normalizeRules(rules);
        await rerunFolderAnalysis(id);
        return cloneRules(folder.rules);
      },
      getDuplicateMinLines: async (id) => getFolderState(id).duplicateMinLines,
      setDuplicateMinLines: async (id, count) => {
        const folder = getFolderState(id);
        folder.duplicateMinLines = Math.max(3, Math.floor(count));
        await rerunFolderAnalysis(id, { duplicateMinLines: folder.duplicateMinLines, detectDuplicates: true });
      },
      getDuplicateRules: async (id) => cloneRules(getFolderState(id).duplicateRules),
      setDuplicateRules: async (id, rules) => {
        const folder = getFolderState(id);
        folder.duplicateRules = normalizeRules(rules);
        await rerunFolderAnalysis(id, { duplicateRules: folder.duplicateRules, detectDuplicates: true });
        return cloneRules(folder.duplicateRules);
      },
      pickDirectory: async () => {
        const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
        if (picker) {
          try {
            const handle = await picker.call(window);
            const files = await collectFromDirectoryHandle(handle);
            if (files.length === 0) return null;
            return stageImport(files, handle.name);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error ?? '');
            if (/user aborted|the request is not allowed/i.test(message) && !/intercept/i.test(message)) {
              return null;
            }
          }
        }

        return openDirectoryPickerFallback();
      },
    },
    scan: {
      run: async (folderId, opts) => rerunFolderAnalysis(folderId, opts),
      cancel: async () => {
        scanCancelled = true;
      },
      onProgress: (cb) => {
        scanListeners.add(cb);
        return () => {
          scanListeners.delete(cb);
        };
      },
    },
    settings: {
      getGlobalRules: async () => getGlobalRules(),
      setGlobalRules: async (rules) => {
        const normalized = setGlobalRulesStorage(rules);
        for (const folder of folders.values()) {
          await rerunFolderAnalysis(folder.row.id);
        }
        return normalized;
      },
    },
    stats: {
      summary: async (folderId) => folders.get(folderId)?.analysis?.summary ?? emptySummary(),
      tree: async (folderId) => folders.get(folderId)?.analysis?.tree ?? emptyTree(),
      topFiles: async (folderId, limit = 50, sortBy = 'total') => {
        const topFiles = folders.get(folderId)?.analysis?.topFiles ?? [];
        const sorted = [...topFiles].sort((left, right) => (sortBy === 'size' ? right.size - left.size : right.total - left.total));
        return sorted.slice(0, limit).map(file => ({ ...file, lastCommitDate: null }));
      },
      topFunctions: async (folderId, limit = 50) => (folders.get(folderId)?.analysis?.topFunctions ?? []).slice(0, limit),
      apiRoutes: async (folderId) => {
        const files = filesForSharedAnalysis(folderId);
        if (files.length === 0) return emptyApiRoutes();
        return buildApiRouteOverview(files);
      },
      fileRelations: async (folderId) => {
        const files = filesForSharedAnalysis(folderId);
        if (files.length === 0) return emptyFileRelations();
        return buildFileRelationGraph(files);
      },
      laravelSchema: async (folderId) => {
        const files = filesForSharedAnalysis(folderId);
        if (files.length === 0) return emptyLaravelSchema();
        return buildLaravelSchemaGraph(files);
      },
      tags: async (folderId, kind) => {
        const tags = folders.get(folderId)?.analysis?.tags ?? [];
        return kind ? tags.filter(tag => tag.kind === kind) : tags;
      },
      fileTags: async (folderId, relPath) => {
        const file = findAnalyzedFile(folderId, relPath);
        return file?.tags ?? [];
      },
      heatmap: async (folderId, days = 30) => {
        const heatmap = folders.get(folderId)?.analysis?.heatmap ?? [];
        const since = Date.now() - days * 86400_000;
        return heatmap.filter(bucket => new Date(bucket.date).getTime() >= since);
      },
      duplicates: async (folderId) => folders.get(folderId)?.analysis?.duplicates ?? [],
    },
    file: {
      read: async (folderId, relPath) => {
        const file = findAnalyzedFile(folderId, relPath);
        if (!file) throw new Error(`File ${relPath} was not found.`);
        return { content: file.content, meta: file.meta };
      },
      write: async (folderId, relPath, content) => {
        const folder = getFolderState(folderId);
        const normalized = normalizeRelPath(relPath);
        const sourceFile = folder.files.find(file => file.relPath === normalized);
        if (!sourceFile) throw new Error(`File ${relPath} was not found.`);

        sourceFile.contentOverride = content;
        await rerunFolderAnalysis(folderId, { detectDuplicates: true, duplicateMinLines: folder.duplicateMinLines });
        const nextFile = findAnalyzedFile(folderId, relPath);
        if (!nextFile) throw new Error(`File ${relPath} was not found after save.`);
        return nextFile.meta;
      },
      meta: async (folderId, relPath) => findAnalyzedFile(folderId, relPath)?.meta ?? null,
    },
    git: {
      fileInfo: async () => null,
      repoInfo: async () => null,
    },
    system: {
      showTreeNodeContextMenu: async () => undefined,
      openExternal: async (url) => {
        window.open(url, '_blank', 'noopener,noreferrer');
      },
    },
  };
}
