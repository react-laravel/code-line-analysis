import { contextBridge, ipcRenderer } from 'electron';
import type { Api, ScanProgress } from '../shared/api';
import { IPC_CHANNELS } from '../shared/ipcChannels';

const api: Api = {
  runtime: {
    mode: 'electron',
    supportsNativeFolderSelection: true,
    supportsDirectoryDropImport: false,
    supportsFileWrite: true,
    supportsExternalLinks: true,
  },
  folders: {
    add: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_ADD, rootPath),
    addGitRepositories: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_ADD_GIT_REPOSITORIES, rootPath),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_LIST),
    relocate: (id, rootPath) => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_RELOCATE, id, rootPath),
    remove: (id) => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_REMOVE, id),
    getRules: (id) => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_GET_RULES, id),
    setRules: (id, rules) => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_SET_RULES, id, rules),
    getDuplicateMinLines: (id) => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_GET_DUPLICATE_MIN_LINES, id),
    setDuplicateMinLines: (id, count) => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_SET_DUPLICATE_MIN_LINES, id, count),
    getDuplicateRules: (id) => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_GET_DUPLICATE_RULES, id),
    setDuplicateRules: (id, rules) => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_SET_DUPLICATE_RULES, id, rules),
    pickDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_PICK_DIRECTORY),
  },
  scan: {
    run: (folderId, opts) => ipcRenderer.invoke(IPC_CHANNELS.SCAN_RUN, folderId, opts ?? {}),
    cancel: () => ipcRenderer.invoke(IPC_CHANNELS.SCAN_CANCEL),
    onProgress: (cb) => {
      const listener = (_e: unknown, p: ScanProgress) => cb(p);
      ipcRenderer.on(IPC_CHANNELS.SCAN_PROGRESS, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SCAN_PROGRESS, listener);
    },
  },
  settings: {
    getGlobalRules: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_GLOBAL_RULES),
    setGlobalRules: (rules) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET_GLOBAL_RULES, rules),
  },
  stats: {
    summary: (folderId) => ipcRenderer.invoke(IPC_CHANNELS.STATS_SUMMARY, folderId),
    tree: (folderId) => ipcRenderer.invoke(IPC_CHANNELS.STATS_TREE, folderId),
    topFiles: (folderId, limit, sortBy) => ipcRenderer.invoke(IPC_CHANNELS.STATS_TOP_FILES, folderId, limit, sortBy),
    topFunctions: (folderId, limit) => ipcRenderer.invoke(IPC_CHANNELS.STATS_TOP_FUNCTIONS, folderId, limit),
    apiRoutes: (folderId) => ipcRenderer.invoke(IPC_CHANNELS.STATS_API_ROUTES, folderId),
    fileRelations: (folderId) => ipcRenderer.invoke(IPC_CHANNELS.STATS_FILE_RELATIONS, folderId),
    laravelSchema: (folderId) => ipcRenderer.invoke(IPC_CHANNELS.STATS_LARAVEL_SCHEMA, folderId),
    tags: (folderId, kind) => ipcRenderer.invoke(IPC_CHANNELS.STATS_TAGS, folderId, kind),
    fileTags: (folderId, relPath) => ipcRenderer.invoke(IPC_CHANNELS.STATS_FILE_TAGS, folderId, relPath),
    heatmap: (folderId, days) => ipcRenderer.invoke(IPC_CHANNELS.STATS_HEATMAP, folderId, days),
    duplicates: (folderId) => ipcRenderer.invoke(IPC_CHANNELS.STATS_DUPLICATES, folderId),
  },
  file: {
    read: (folderId, relPath) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ, folderId, relPath),
    write: (folderId, relPath, content) => ipcRenderer.invoke(IPC_CHANNELS.FILE_WRITE, folderId, relPath, content),
    meta: (folderId, relPath) => ipcRenderer.invoke(IPC_CHANNELS.FILE_META, folderId, relPath),
  },
  git: {
    fileInfo: (folderId, relPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_FILE_INFO, folderId, relPath),
    repoInfo: (folderId) => ipcRenderer.invoke(IPC_CHANNELS.GIT_REPO_INFO, folderId),
  },
  system: {
    showTreeNodeContextMenu: (request) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SHOW_TREE_NODE_CONTEXT_MENU, request),
    openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, url),
  },
};

contextBridge.exposeInMainWorld('api', api);
