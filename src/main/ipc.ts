import { ipcMain, dialog, BrowserWindow, Menu, clipboard, shell } from 'electron';
import path from 'node:path';
import { watch, statSync, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getDb } from './db';
import { scanFolder, cancelScan } from './scanner';
import {
  getSummary, getTree, getTopFiles, getTopFunctions, getTags, getFileTags, getDuplicates,
} from './stats';
import { getGitFileInfo, getGitHeatmap, getGitRepoInfo, clearGitCache } from './git';
import { detectLang } from './parsers/languages';
import { countLines } from './parsers/lineParser';
import { scanTags } from './parsers/tagScanner';
import type {
  FolderRow, FolderRules, FileMeta, ScanOptions, TopFileSortKey, TreeNodeContextMenuRequest,
} from '../shared/api';
import { DEFAULT_BLACKLIST, DEFAULT_DUPLICATE_LINES } from '../shared/api';

const GLOBAL_RULES_KEY = 'globalRules';
let disposeIpcResources = () => undefined;

function duplicateMinLinesKey(folderId: number): string {
  return `duplicateMinLines:${folderId}`;
}

function duplicateRulesKey(folderId: number): string {
  return `duplicateRules:${folderId}`;
}

function rowToFolder(r: any): FolderRow {
  return { id: r.id, rootPath: r.root_path, name: r.name, createdAt: r.created_at };
}

function ensureInsideRoot(root: string, relPath: string): string {
  const abs = path.resolve(root, relPath);
  const rootResolved = path.resolve(root);
  if (!abs.startsWith(rootResolved + path.sep) && abs !== rootResolved) {
    throw new Error('Path outside folder root rejected');
  }
  return abs;
}

function normalizeRules(rules: FolderRules): FolderRules {
  return {
    whitelist: Array.from(new Set(rules.whitelist.map(pattern => pattern.trim()).filter(Boolean))),
    blacklist: Array.from(new Set(rules.blacklist.map(pattern => pattern.trim()).filter(Boolean))),
  };
}

function getFolderRules(db: ReturnType<typeof getDb>, id: number): FolderRules {
  const rows = db.prepare('SELECT type, pattern FROM rules WHERE folder_id = ?').all(id) as Array<{ type: string; pattern: string }>;
  return normalizeRules({
    whitelist: rows.filter(r => r.type === 'whitelist').map(r => r.pattern),
    blacklist: rows.filter(r => r.type === 'blacklist').map(r => r.pattern),
  });
}

function getGlobalRules(db: ReturnType<typeof getDb>): FolderRules {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(GLOBAL_RULES_KEY) as { value: string } | undefined;
  if (!row) return { whitelist: [], blacklist: [...DEFAULT_BLACKLIST] };

  try {
    const parsed = JSON.parse(row.value) as Partial<FolderRules>;
    return normalizeRules({
      whitelist: Array.isArray(parsed.whitelist) ? parsed.whitelist : [],
      blacklist: Array.isArray(parsed.blacklist) ? parsed.blacklist : [],
    });
  } catch {
    return { whitelist: [], blacklist: [...DEFAULT_BLACKLIST] };
  }
}

function setGlobalRules(db: ReturnType<typeof getDb>, rules: FolderRules): void {
  const normalized = normalizeRules(rules);
  db.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(GLOBAL_RULES_KEY, JSON.stringify(normalized));
}

function normalizeDuplicateMinLines(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 3) return DEFAULT_DUPLICATE_LINES;
  return parsed;
}

function getDuplicateMinLines(db: ReturnType<typeof getDb>, folderId: number): number {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(duplicateMinLinesKey(folderId)) as { value: string } | undefined;
  if (!row) return DEFAULT_DUPLICATE_LINES;
  return normalizeDuplicateMinLines(row.value);
}

function setDuplicateMinLines(db: ReturnType<typeof getDb>, folderId: number, count: number): void {
  const normalized = normalizeDuplicateMinLines(count);
  db.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(duplicateMinLinesKey(folderId), String(normalized));
}

function getDuplicateRules(db: ReturnType<typeof getDb>, folderId: number): FolderRules {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(duplicateRulesKey(folderId)) as { value: string } | undefined;
  if (!row) return { whitelist: [], blacklist: [] };

  try {
    const parsed = JSON.parse(row.value) as Partial<FolderRules>;
    return normalizeRules({
      whitelist: Array.isArray(parsed.whitelist) ? parsed.whitelist : [],
      blacklist: Array.isArray(parsed.blacklist) ? parsed.blacklist : [],
    });
  } catch {
    return { whitelist: [], blacklist: [] };
  }
}

function setDuplicateRules(db: ReturnType<typeof getDb>, folderId: number, rules: FolderRules): void {
  const normalized = normalizeRules(rules);
  db.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(duplicateRulesKey(folderId), JSON.stringify(normalized));
}

function resolveRules(globalRules: FolderRules, folderRules: FolderRules): FolderRules {
  return {
    whitelist: folderRules.whitelist.length > 0 ? folderRules.whitelist : globalRules.whitelist,
    blacklist: Array.from(new Set([...globalRules.blacklist, ...folderRules.blacklist])),
  };
}

async function fileMeta(folderId: number, root: string, relPath: string): Promise<FileMeta | null> {
  const db = getDb();
  const row = db.prepare(`
    SELECT rel_path AS relPath, lang, size, mtime, hash, total, code, comment, blank, block_comment AS blockComment
    FROM files WHERE folder_id = ? AND rel_path = ? AND deleted = 0
  `).get(folderId, relPath) as FileMeta | undefined;
  return row ?? null;
}

export function disposeRegisteredIpcResources(): void {
  disposeIpcResources();
}

export function registerIpc(getMainWindow: () => BrowserWindow | null): void {
  const db = getDb();
  const folderWatchers = new Map<number, FSWatcher>();
  const folderWatchTimers = new Map<number, NodeJS.Timeout>();
  let scanQueue: Promise<unknown> = Promise.resolve();

  function shouldIgnoreWatchedPath(relPath: string): boolean {
    const normalized = relPath.split(path.sep).join('/');
    if (!normalized) return true;
    if (normalized.startsWith('.git/') || normalized.includes('/.git/')) return true;
    if (normalized.startsWith('node_modules/') || normalized.includes('/node_modules/')) return true;
    if (normalized.startsWith('dist/') || normalized.includes('/dist/')) return true;
    if (normalized.startsWith('build/') || normalized.includes('/build/')) return true;
    if (normalized.startsWith('.idea/') || normalized.includes('/.idea/')) return true;
    if (normalized.startsWith('.vscode/') || normalized.includes('/.vscode/')) return true;
    if (normalized.endsWith('.min.js') || normalized.endsWith('.min.css')) return true;
    if (normalized.endsWith('.lock') || normalized.endsWith('package-lock.json') || normalized.endsWith('yarn.lock') || normalized.endsWith('pnpm-lock.yaml')) return true;
    return false;
  }

  async function performFolderScan(folderId: number, opts: ScanOptions = {}) {
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId) as any;
    if (!folder) throw new Error('Folder not found');
    const rules = resolveRules(getGlobalRules(db), getFolderRules(db, folderId));
    await scanFolder(folderId, folder.root_path, rules, {
      ...opts,
      duplicateMinLines: getDuplicateMinLines(db, folderId),
      duplicateRules: getDuplicateRules(db, folderId),
    }, p => {
      const win = getMainWindow();
      win?.webContents.send('scan:progress', p);
    });
    clearGitCache();
    return getSummary(folderId);
  }

  function enqueueFolderScan(folderId: number, opts: ScanOptions = {}) {
    const task = scanQueue.then(() => performFolderScan(folderId, opts), () => performFolderScan(folderId, opts));
    scanQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  function clearFolderWatchTimer(folderId: number): void {
    const timer = folderWatchTimers.get(folderId);
    if (!timer) return;
    clearTimeout(timer);
    folderWatchTimers.delete(folderId);
  }

  function stopFolderWatcher(folderId: number): void {
    clearFolderWatchTimer(folderId);
    const watcher = folderWatchers.get(folderId);
    if (!watcher) return;
    watcher.close();
    folderWatchers.delete(folderId);
  }

  function scheduleFolderWatchScan(folderId: number): void {
    clearFolderWatchTimer(folderId);
    folderWatchTimers.set(folderId, setTimeout(() => {
      folderWatchTimers.delete(folderId);
      void enqueueFolderScan(folderId, { detectDuplicates: true }).catch(() => undefined);
    }, 900));
  }

  function startFolderWatcher(folderId: number, rootPath: string): void {
    stopFolderWatcher(folderId);
    try {
      const watcher = watch(rootPath, { recursive: true }, (_eventType, filename) => {
        const relPath = typeof filename === 'string' ? filename : '';
        if (shouldIgnoreWatchedPath(relPath)) return;
        scheduleFolderWatchScan(folderId);
      });
      watcher.on('error', () => stopFolderWatcher(folderId));
      folderWatchers.set(folderId, watcher);
    } catch {
      stopFolderWatcher(folderId);
    }
  }

  function refreshFolderWatchers(): void {
    const rows = db.prepare('SELECT id, root_path FROM folders').all() as Array<{ id: number; root_path: string }>;
    const activeFolderIds = new Set(rows.map(row => row.id));
    for (const row of rows) startFolderWatcher(row.id, row.root_path);
    for (const folderId of Array.from(folderWatchers.keys())) {
      if (!activeFolderIds.has(folderId)) stopFolderWatcher(folderId);
    }
  }

  disposeIpcResources = () => {
    for (const folderId of Array.from(folderWatchers.keys())) stopFolderWatcher(folderId);
  };

  ipcMain.handle('folders:add', (_e, rootPath: string) => {
    const stats = statSync(rootPath);
    if (!stats.isDirectory()) throw new Error('Not a directory');
    const name = path.basename(rootPath);
    const now = Date.now();
    const stmt = db.prepare('INSERT INTO folders (root_path, name, created_at) VALUES (?, ?, ?) ON CONFLICT(root_path) DO UPDATE SET name = excluded.name RETURNING *');
    const row = stmt.get(rootPath, name, now) as { id: number; root_path: string; name: string; created_at: number };
    startFolderWatcher(row.id, row.root_path);
    return rowToFolder(row);
  });

  ipcMain.handle('folders:list', () => {
    const rows = db.prepare('SELECT * FROM folders ORDER BY created_at DESC').all();
    return rows.map(rowToFolder);
  });

  ipcMain.handle('folders:remove', (_e, id: number) => {
    stopFolderWatcher(id);
    db.prepare('DELETE FROM folders WHERE id = ?').run(id);
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(duplicateMinLinesKey(id));
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(duplicateRulesKey(id));
  });

  ipcMain.handle('folders:getRules', (_e, id: number): FolderRules => {
    return getFolderRules(db, id);
  });

  ipcMain.handle('folders:getDuplicateMinLines', (_e, id: number): number => getDuplicateMinLines(db, id));

  ipcMain.handle('folders:getDuplicateRules', (_e, id: number): FolderRules => getDuplicateRules(db, id));

  ipcMain.handle('folders:setDuplicateMinLines', async (_e, id: number, count: number) => {
    setDuplicateMinLines(db, id, count);
    await enqueueFolderScan(id, { detectDuplicates: true });
  });

  ipcMain.handle('folders:setDuplicateRules', async (_e, id: number, rules: FolderRules): Promise<FolderRules> => {
    setDuplicateRules(db, id, rules);
    const normalized = getDuplicateRules(db, id);
    void enqueueFolderScan(id, { detectDuplicates: true }).catch(() => undefined);
    return normalized;
  });

  ipcMain.handle('folders:setRules', async (_e, id: number, rules: FolderRules): Promise<FolderRules> => {
    const tx = db.transaction((id: number, rules: FolderRules) => {
      db.prepare('DELETE FROM rules WHERE folder_id = ?').run(id);
      const ins = db.prepare('INSERT INTO rules (folder_id, type, pattern) VALUES (?, ?, ?)');
      const normalized = normalizeRules(rules);
      for (const p of normalized.whitelist) ins.run(id, 'whitelist', p);
      for (const p of normalized.blacklist) ins.run(id, 'blacklist', p);
    });
    tx(id, rules);

    const normalized = getFolderRules(db, id);
    void enqueueFolderScan(id, { detectDuplicates: true }).catch(() => undefined);
    return normalized;
  });

  ipcMain.handle('settings:getGlobalRules', (): FolderRules => getGlobalRules(db));

  ipcMain.handle('settings:setGlobalRules', async (_e, rules: FolderRules): Promise<FolderRules> => {
    setGlobalRules(db, rules);

    const normalized = getGlobalRules(db);
    const folderRows = db.prepare('SELECT id FROM folders').all() as Array<{ id: number }>;
    for (const folder of folderRows) {
      void enqueueFolderScan(folder.id, { detectDuplicates: true }).catch(() => undefined);
    }

    return normalized;
  });

  ipcMain.handle('folders:pickDirectory', async () => {
    const win = getMainWindow();
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('scan:run', async (_e, folderId: number, opts: ScanOptions = {}) => {
    return await enqueueFolderScan(folderId, opts);
  });

  ipcMain.handle('scan:cancel', () => { cancelScan(); });

  ipcMain.handle('stats:summary', (_e, folderId: number) => getSummary(folderId));
  ipcMain.handle('stats:tree', (_e, folderId: number) => getTree(folderId));
  ipcMain.handle('stats:topFiles', (_e, folderId: number, limit?: number, sortBy?: TopFileSortKey) => getTopFiles(folderId, limit, sortBy));
  ipcMain.handle('stats:topFunctions', (_e, folderId: number, limit?: number) => getTopFunctions(folderId, limit));
  ipcMain.handle('stats:tags', (_e, folderId: number, kind?: string) => getTags(folderId, kind));
  ipcMain.handle('stats:fileTags', (_e, folderId: number, relPath: string) => getFileTags(folderId, relPath));
  ipcMain.handle('stats:heatmap', async (_e, folderId: number, days?: number) => {
    const folder = db.prepare('SELECT root_path FROM folders WHERE id = ?').get(folderId) as { root_path: string } | undefined;
    if (!folder) return [];
    return await getGitHeatmap(folder.root_path, days);
  });
  ipcMain.handle('stats:duplicates', (_e, folderId: number) => getDuplicates(folderId));

  ipcMain.handle('file:read', async (_e, folderId: number, relPath: string) => {
    const folder = db.prepare('SELECT root_path FROM folders WHERE id = ?').get(folderId) as { root_path: string } | undefined;
    if (!folder) throw new Error('Folder not found');
    const abs = ensureInsideRoot(folder.root_path, relPath);
    const content = await fs.readFile(abs, 'utf-8');
    const meta = await fileMeta(folderId, folder.root_path, relPath);
    return { content, meta };
  });

  ipcMain.handle('file:write', async (_e, folderId: number, relPath: string, content: string) => {
    const folder = db.prepare('SELECT root_path FROM folders WHERE id = ?').get(folderId) as { root_path: string } | undefined;
    if (!folder) throw new Error('Folder not found');
    const abs = ensureInsideRoot(folder.root_path, relPath);
    await fs.writeFile(abs, content, 'utf-8');
    // Recompute metadata for this single file.
    const stat = await fs.stat(abs);
    const buf = Buffer.from(content, 'utf-8');
    const hash = createHash('sha1').update(buf).digest('hex');
    const { ext, lang, langId } = detectLang(relPath);
    const counts = countLines(content, lang);
    const tags = scanTags(content, lang);
    const now = Date.now();
    db.prepare(`
      INSERT INTO files (folder_id, rel_path, lang, ext, size, mtime, hash, total, code, comment, blank, block_comment, scanned_at, deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(folder_id, rel_path) DO UPDATE SET
        lang = excluded.lang, ext = excluded.ext, size = excluded.size, mtime = excluded.mtime,
        hash = excluded.hash, total = excluded.total, code = excluded.code,
        comment = excluded.comment, blank = excluded.blank, block_comment = excluded.block_comment,
        scanned_at = excluded.scanned_at, deleted = 0
    `).run(folderId, relPath, langId, ext, stat.size, Math.floor(stat.mtimeMs), hash,
           counts.total, counts.code, counts.comment, counts.blank, counts.blockComment, now);

    const fileRow = db.prepare('SELECT id FROM files WHERE folder_id = ? AND rel_path = ?').get(folderId, relPath) as { id: number } | undefined;
    if (fileRow) {
      db.prepare('DELETE FROM tags WHERE file_id = ?').run(fileRow.id);
      const insertTag = db.prepare('INSERT INTO tags (file_id, kind, line_no, text) VALUES (?, ?, ?, ?)');
      for (const tag of tags) {
        insertTag.run(fileRow.id, tag.kind, tag.lineNo, tag.text);
      }
    }

    return await fileMeta(folderId, folder.root_path, relPath);
  });

  ipcMain.handle('file:meta', (_e, folderId: number, relPath: string) => {
    const folder = db.prepare('SELECT root_path FROM folders WHERE id = ?').get(folderId) as { root_path: string } | undefined;
    if (!folder) return null;
    return fileMeta(folderId, folder.root_path, relPath);
  });

  ipcMain.handle('git:fileInfo', async (_e, folderId: number, relPath: string) => {
    const folder = db.prepare('SELECT root_path FROM folders WHERE id = ?').get(folderId) as { root_path: string } | undefined;
    if (!folder) return null;
    return await getGitFileInfo(folder.root_path, relPath);
  });

  ipcMain.handle('git:repoInfo', async (_e, folderId: number) => {
    const folder = db.prepare('SELECT root_path FROM folders WHERE id = ?').get(folderId) as { root_path: string } | undefined;
    if (!folder) return null;
    return await getGitRepoInfo(folder.root_path);
  });

  ipcMain.handle('system:showTreeNodeContextMenu', (event, request: TreeNodeContextMenuRequest) => {
    const folder = db.prepare('SELECT root_path FROM folders WHERE id = ?').get(request.folderId) as { root_path: string } | undefined;
    if (!folder) throw new Error('Folder not found');

    const absPath = request.relPath
      ? ensureInsideRoot(folder.root_path, request.relPath)
      : path.resolve(folder.root_path);
    const relPath = request.relPath || '.';

    const menu = Menu.buildFromTemplate([
      {
        label: request.labels.copyName,
        click: () => clipboard.writeText(request.displayName),
      },
      {
        label: request.labels.copyRelativePath,
        click: () => clipboard.writeText(relPath),
      },
      {
        label: request.labels.copyAbsolutePath,
        click: () => clipboard.writeText(absPath),
      },
      { type: 'separator' },
      {
        label: request.labels.openPath,
        click: () => {
          void shell.openPath(absPath).then(error => {
            if (error) dialog.showErrorBox('Unable to open path', error);
          });
        },
      },
      {
        label: request.labels.revealInFinder,
        click: () => shell.showItemInFolder(absPath),
      },
    ]);

    const win = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow();
    const x = typeof request.x === 'number' && Number.isFinite(request.x) ? Math.round(request.x) : undefined;
    const y = typeof request.y === 'number' && Number.isFinite(request.y) ? Math.round(request.y) : undefined;
    menu.popup({
      window: win ?? undefined,
      x,
      y,
    });
  });

  ipcMain.handle('system:openExternal', async (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http/https URLs are allowed');
    }
    await shell.openExternal(parsed.toString());
  });

  refreshFolderWatchers();
}
