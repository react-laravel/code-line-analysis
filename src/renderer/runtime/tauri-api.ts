import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  Api,
  DirNode,
  DuplicateCluster,
  FileMeta,
  FolderRow,
  FolderRules,
  FolderStats,
  GitFileInfo,
  GitRepoInfo,
  HeatmapBucket,
  ScanOptions,
  ScanProgress,
  TagRow,
  TopFile,
  TopFileSortKey,
  TopFunction,
  TreeNodeContextMenuRequest,
} from '@shared/api';
import type { ApiRouteOverview } from '@shared/apiRoutes';
import type { FileRelationGraph } from '@shared/fileRelations';
import type { LaravelSchemaGraph } from '@shared/laravelSchema';

function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  let disposed = false;
  let unlisten: UnlistenFn | null = null;
  void listen<T>(event, (e) => {
    callback(e.payload);
  }).then((fn) => {
    // Cleanup may run before listen() resolves; unlisten immediately so the
    // listener does not leak (StrictMode double-mounts hit this path).
    if (disposed) {
      void fn();
    } else {
      unlisten = fn;
    }
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export function createTauriApi(): Api {
  return {
    runtime: {
      mode: 'tauri',
      supportsNativeFolderSelection: true,
      supportsFileWrite: true,
      supportsExternalLinks: true,
    },
    folders: {
      add: (rootPath) => invoke('folders_add', { rootPath }),
      addGitRepositories: (rootPath) => invoke('folders_add_git_repositories', { rootPath }),
      list: () => invoke('folders_list'),
      relocate: (id, rootPath) => invoke('folders_relocate', { id, rootPath }),
      remove: (id) => invoke('folders_remove', { id }),
      getRules: (id) => invoke('folders_get_rules', { id }),
      setRules: (id, rules) => invoke('folders_set_rules', { id, rules }),
      getDuplicateMinLines: (id) => invoke('folders_get_duplicate_min_lines', { id }),
      setDuplicateMinLines: (id, count) => invoke('folders_set_duplicate_min_lines', { id, count }),
      getDuplicateRules: (id) => invoke('folders_get_duplicate_rules', { id }),
      setDuplicateRules: (id, rules) => invoke('folders_set_duplicate_rules', { id, rules }),
      pickDirectory: async () => {
        const selected = await open({ directory: true, multiple: false });
        if (selected == null) return null;
        return Array.isArray(selected) ? selected[0] ?? null : selected;
      },
    },
    scan: {
      run: (folderId, opts) => invoke('scan_run', { folderId, opts: opts ?? {} }),
      cancel: () => invoke('scan_cancel'),
      onProgress: (cb) => subscribe<ScanProgress>('scan:progress', cb),
    },
    settings: {
      getDetectDuplicates: () => invoke('settings_get_detect_duplicates'),
      setDetectDuplicates: (enabled) => invoke('settings_set_detect_duplicates', { enabled }),
      getGlobalRules: () => invoke('settings_get_global_rules'),
      setGlobalRules: (rules) => invoke('settings_set_global_rules', { rules }),
    },
    stats: {
      summary: (folderId) => invoke('stats_summary', { folderId }),
      tree: (folderId, expandedPaths) => invoke('stats_tree', { folderId, expandedPaths: expandedPaths ?? null }),
      filesPage: (folderId, offset, limit) => invoke('stats_files_page', { folderId, offset: offset ?? 0, limit: limit ?? 1000 }),
      fileDates: (folderId) => invoke('stats_file_dates', { folderId }),
      topFiles: (folderId, limit, sortBy) =>
        invoke('stats_top_files', { folderId, limit: limit ?? null, sortBy: sortBy ?? null }),
      topFunctions: (folderId, limit) =>
        invoke('stats_top_functions', { folderId, limit: limit ?? null }),
      apiRoutes: (folderId) => invoke('stats_api_routes', { folderId }),
      fileRelations: (folderId) => invoke('stats_file_relations', { folderId }),
      laravelSchema: (folderId) => invoke('stats_laravel_schema', { folderId }),
      tags: (folderId, kind) => invoke('stats_tags', { folderId, kind: kind ?? null }),
      fileTags: (folderId, relPath) => invoke('stats_file_tags', { folderId, relPath }),
      heatmap: (folderId, days) => invoke('stats_heatmap', { folderId, days: days ?? null }),
      duplicates: (folderId) => invoke('stats_duplicates', { folderId }),
    },
    file: {
      read: (folderId, relPath) => invoke('file_read', { folderId, relPath }),
      write: (folderId, relPath, content, expectedHash) => invoke('file_write', { folderId, relPath, content, expectedHash }),
      meta: (folderId, relPath) => invoke('file_meta', { folderId, relPath }),
    },
    git: {
      fileInfo: (folderId, relPath, requestId) => invoke('git_file_info', { folderId, relPath, requestId: requestId ?? null }),
      cancelFileInfo: (requestId) => invoke('git_cancel_file_info', { requestId }),
      repoInfo: (folderId) => invoke('git_repo_info', { folderId }),
    },
    system: {
      showTreeNodeContextMenu: (request: TreeNodeContextMenuRequest) =>
        invoke('system_show_tree_node_context_menu', { request }),
      openExternal: (url) => invoke('system_open_external', { url }),
    },
  };
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// Silence unused type imports in some TS configs
export type _Keep = FolderRow & FolderRules & FolderStats & DirNode & DuplicateCluster & FileMeta &
  GitFileInfo & GitRepoInfo & HeatmapBucket & ScanOptions & TagRow & TopFile & TopFileSortKey &
  TopFunction & ApiRouteOverview & FileRelationGraph & LaravelSchemaGraph;
