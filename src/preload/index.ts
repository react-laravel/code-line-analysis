import { contextBridge, ipcRenderer } from 'electron';
import type { Api, ScanProgress } from '../shared/api';

const api: Api = {
  folders: {
    add: (rootPath) => ipcRenderer.invoke('folders:add', rootPath),
    list: () => ipcRenderer.invoke('folders:list'),
    remove: (id) => ipcRenderer.invoke('folders:remove', id),
    getRules: (id) => ipcRenderer.invoke('folders:getRules', id),
    setRules: (id, rules) => ipcRenderer.invoke('folders:setRules', id, rules),
    getDuplicateMinLines: (id) => ipcRenderer.invoke('folders:getDuplicateMinLines', id),
    setDuplicateMinLines: (id, count) => ipcRenderer.invoke('folders:setDuplicateMinLines', id, count),
    pickDirectory: () => ipcRenderer.invoke('folders:pickDirectory'),
  },
  scan: {
    run: (folderId, opts) => ipcRenderer.invoke('scan:run', folderId, opts ?? {}),
    cancel: () => ipcRenderer.invoke('scan:cancel'),
    onProgress: (cb) => {
      const listener = (_e: unknown, p: ScanProgress) => cb(p);
      ipcRenderer.on('scan:progress', listener);
      return () => ipcRenderer.removeListener('scan:progress', listener);
    },
  },
  settings: {
    getGlobalRules: () => ipcRenderer.invoke('settings:getGlobalRules'),
    setGlobalRules: (rules) => ipcRenderer.invoke('settings:setGlobalRules', rules),
  },
  stats: {
    summary: (folderId) => ipcRenderer.invoke('stats:summary', folderId),
    tree: (folderId) => ipcRenderer.invoke('stats:tree', folderId),
    topFiles: (folderId, limit, sortBy) => ipcRenderer.invoke('stats:topFiles', folderId, limit, sortBy),
    topFunctions: (folderId, limit) => ipcRenderer.invoke('stats:topFunctions', folderId, limit),
    tags: (folderId, kind) => ipcRenderer.invoke('stats:tags', folderId, kind),
    fileTags: (folderId, relPath) => ipcRenderer.invoke('stats:fileTags', folderId, relPath),
    heatmap: (folderId, days) => ipcRenderer.invoke('stats:heatmap', folderId, days),
    duplicates: (folderId) => ipcRenderer.invoke('stats:duplicates', folderId),
  },
  file: {
    read: (folderId, relPath) => ipcRenderer.invoke('file:read', folderId, relPath),
    write: (folderId, relPath, content) => ipcRenderer.invoke('file:write', folderId, relPath, content),
    meta: (folderId, relPath) => ipcRenderer.invoke('file:meta', folderId, relPath),
  },
  git: {
    fileInfo: (folderId, relPath) => ipcRenderer.invoke('git:fileInfo', folderId, relPath),
    repoInfo: (folderId) => ipcRenderer.invoke('git:repoInfo', folderId),
  },
  system: {
    showTreeNodeContextMenu: (request) => ipcRenderer.invoke('system:showTreeNodeContextMenu', request),
    openExternal: (url) => ipcRenderer.invoke('system:openExternal', url),
  },
};

contextBridge.exposeInMainWorld('api', api);
