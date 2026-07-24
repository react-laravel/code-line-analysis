import type { ApiRouteOverview } from './apiRoutes';
import type { FileRelationGraph } from './fileRelations';
import type { LaravelSchemaGraph } from './laravelSchema';

export type { ApiRouteEntry, ApiRouteOverview } from './apiRoutes';
export type { FileRelationEdge, FileRelationGraph, FileRelationNode } from './fileRelations';
export type { LaravelSchemaColumn, LaravelSchemaGraph, LaravelSchemaRelation, LaravelSchemaTable } from './laravelSchema';

// Shared types between main, preload, and renderer.

export const DEFAULT_BLACKLIST = [
  'node_modules',
  'vendor',
  'dist',
  'build',
  '.git',
  '*.min.js',
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'go.sum',
] as const;

export const DEFAULT_DUPLICATE_LINES = 8;

export interface FolderRow {
  id: number;
  rootPath: string;
  name: string;
  createdAt: number;
  isAvailable: boolean;
}

export interface FolderRules {
  whitelist: string[]; // glob patterns; if non-empty, only these are scanned
  blacklist: string[]; // glob patterns; subtracted from candidate set
}

export interface FileRow {
  id: number;
  folderId: number;
  relPath: string;
  lang: string;
  size: number;
  mtime: number;
  hash: string;
  total: number;
  code: number;
  comment: number;
  blank: number;
  blockComment: number;
  scannedAt: number;
  deleted: number;
}

export interface TagRow {
  fileId: number;
  kind: 'TODO' | 'FIXME' | 'HACK' | 'NOTE' | 'XXX';
  lineNo: number;
  text: string;
}

export interface FunctionRow {
  fileId: number;
  name: string;
  startLine: number;
  endLine: number;
  length: number;
}

export interface DuplicateRow {
  hash: string;
  fileId: number;
  startLine: number;
  endLine: number;
}

export interface ScanProgress {
  folderId: number;
  phase: 'walking' | 'parsing' | 'persisting' | 'done';
  total: number;
  done: number;
  current?: string;
  cacheHits?: number;
}

export interface FolderStats {
  totalFiles: number;
  totalLines: number;
  totalCode: number;
  runtimeCode: number;
  testCode: number;
  totalComment: number;
  totalBlank: number;
  totalBlockComment: number;
  byLang: Array<{ lang: string; files: number; total: number; code: number; comment: number; blank: number }>;
  tagCounts: Record<string, number>;
}

export interface DirNode {
  name: string;
  path: string; // relPath; '' for root
  isDir: boolean;
  total: number;
  code: number;
  comment: number;
  blank: number;
  files: number;
  children?: DirNode[];
}

export interface TopFile {
  relPath: string;
  total: number;
  code: number;
  size: number;
  lang: string;
  lastCommitDate: number | null;
}

export type TopFileSortKey = 'total' | 'size' | 'lastCommitDate';

export interface TopFunction {
  relPath: string;
  name: string;
  startLine: number;
  endLine: number;
  length: number;
}

export interface HeatmapBucket {
  date: string; // YYYY-MM-DD
  files: number;
  lines: number;
}

export interface DuplicateCluster {
  hash: string;
  occurrences: Array<{ relPath: string; startLine: number; endLine: number }>;
  lines: number;
}

export interface FileMeta {
  relPath: string;
  size: number;
  mtime: number;
  lang: string;
  total: number;
  code: number;
  comment: number;
  blank: number;
  blockComment: number;
  hash: string;
}

export interface GitFileInfo {
  lastSha: string | null;
  lastAuthor: string | null;
  lastDate: number | null;
  topAuthors: Array<{ author: string; lines: number }>;
}

export interface GitRepoInfo {
  lastCommitSha: string | null;
  lastCommitDate: number | null;
  remoteOriginUrl: string | null;
  remoteOriginWebUrl: string | null;
}

export interface ScanOptions {
  full?: boolean;
  detectDuplicates?: boolean;
  duplicateMinLines?: number;
  duplicateRules?: FolderRules;
}

export interface TreeNodeContextMenuLabels {
  copyName: string;
  copyRelativePath: string;
  copyAbsolutePath: string;
  openPath: string;
  revealInFinder: string;
}

export interface TreeNodeContextMenuRequest {
  folderId: number;
  relPath: string;
  displayName: string;
  x?: number;
  y?: number;
  labels: TreeNodeContextMenuLabels;
}

export interface ApiRuntimeInfo {
  mode: 'tauri';
  supportsNativeFolderSelection: boolean;
  supportsFileWrite: boolean;
  supportsExternalLinks: boolean;
}

export interface Api {
  runtime: ApiRuntimeInfo;
  folders: {
    add: (rootPath: string) => Promise<FolderRow>;
    addGitRepositories: (rootPath: string) => Promise<FolderRow[]>;
    list: () => Promise<FolderRow[]>;
    relocate: (id: number, rootPath: string) => Promise<FolderRow>;
    remove: (id: number) => Promise<void>;
    getRules: (id: number) => Promise<FolderRules>;
    setRules: (id: number, rules: FolderRules) => Promise<FolderRules>;
    getDuplicateMinLines: (id: number) => Promise<number>;
    setDuplicateMinLines: (id: number, count: number) => Promise<void>;
    getDuplicateRules: (id: number) => Promise<FolderRules>;
    setDuplicateRules: (id: number, rules: FolderRules) => Promise<FolderRules>;
    pickDirectory: () => Promise<string | null>;
  };
  scan: {
    run: (folderId: number, opts?: ScanOptions) => Promise<FolderStats>;
    cancel: () => Promise<void>;
    onProgress: (cb: (p: ScanProgress) => void) => () => void;
  };
  settings: {
    getGlobalRules: () => Promise<FolderRules>;
    setGlobalRules: (rules: FolderRules) => Promise<FolderRules>;
  };
  stats: {
    summary: (folderId: number) => Promise<FolderStats>;
    tree: (folderId: number) => Promise<DirNode>;
    topFiles: (folderId: number, limit?: number, sortBy?: TopFileSortKey) => Promise<TopFile[]>;
    topFunctions: (folderId: number, limit?: number) => Promise<TopFunction[]>;
    apiRoutes: (folderId: number) => Promise<ApiRouteOverview>;
    fileRelations: (folderId: number) => Promise<FileRelationGraph>;
    laravelSchema: (folderId: number) => Promise<LaravelSchemaGraph>;
    tags: (folderId: number, kind?: string) => Promise<Array<TagRow & { relPath: string }>>;
    fileTags: (folderId: number, relPath: string) => Promise<TagRow[]>;
    heatmap: (folderId: number, days?: number) => Promise<HeatmapBucket[]>;
    duplicates: (folderId: number) => Promise<DuplicateCluster[]>;
  };
  file: {
    read: (folderId: number, relPath: string) => Promise<{ content: string; meta: FileMeta }>;
    write: (folderId: number, relPath: string, content: string) => Promise<FileMeta>;
    meta: (folderId: number, relPath: string) => Promise<FileMeta | null>;
  };
  git: {
    fileInfo: (folderId: number, relPath: string) => Promise<GitFileInfo | null>;
    repoInfo: (folderId: number) => Promise<GitRepoInfo | null>;
  };
  system: {
    showTreeNodeContextMenu: (request: TreeNodeContextMenuRequest) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
  };
}

declare global {
  interface Window {
    api: Api;
  }
}
