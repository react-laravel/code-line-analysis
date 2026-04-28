import { ipcMain, dialog, BrowserWindow, Menu, clipboard, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getDb } from './db';
import { scanFolder, cancelScan } from './scanner';
import {
  getSummary, getTree, getTopFiles, getTopFunctions, getTags, getFileTags, getHeatmap, getDuplicates,
} from './stats';
import { getGitFileInfo, clearGitCache } from './git';
import { detectLang } from './parsers/languages';
import { countLines } from './parsers/lineParser';
import { scanTags } from './parsers/tagScanner';
import type {
  FolderRow, FolderRules, FileMeta, ScanOptions, TopFileSortKey, TreeNodeContextMenuRequest,
} from '../shared/api';

function rowToFolder(r: any): FolderRow {
  return { id: r.id, rootPath: r.root_path, name: r.name, baselineAt: r.baseline_at, createdAt: r.created_at };
}

function ensureInsideRoot(root: string, relPath: string): string {
  const abs = path.resolve(root, relPath);
  const rootResolved = path.resolve(root);
  if (!abs.startsWith(rootResolved + path.sep) && abs !== rootResolved) {
    throw new Error('Path outside folder root rejected');
  }
  return abs;
}

async function fileMeta(folderId: number, root: string, relPath: string): Promise<FileMeta | null> {
  const db = getDb();
  const row = db.prepare(`
    SELECT rel_path AS relPath, lang, size, mtime, hash, total, code, comment, blank,
           block_comment AS blockComment, baseline_total AS baselineTotal
    FROM files WHERE folder_id = ? AND rel_path = ? AND deleted = 0
  `).get(folderId, relPath) as FileMeta | undefined;
  return row ?? null;
}

export function registerIpc(getMainWindow: () => BrowserWindow | null): void {
  const db = getDb();

  ipcMain.handle('folders:add', (_e, rootPath: string) => {
    const stats = require('node:fs').statSync(rootPath);
    if (!stats.isDirectory()) throw new Error('Not a directory');
    const name = path.basename(rootPath);
    const now = Date.now();
    const stmt = db.prepare('INSERT INTO folders (root_path, name, created_at) VALUES (?, ?, ?) ON CONFLICT(root_path) DO UPDATE SET name = excluded.name RETURNING *');
    const row = stmt.get(rootPath, name, now);
    return rowToFolder(row);
  });

  ipcMain.handle('folders:list', () => {
    const rows = db.prepare('SELECT * FROM folders ORDER BY created_at DESC').all();
    return rows.map(rowToFolder);
  });

  ipcMain.handle('folders:remove', (_e, id: number) => {
    db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  });

  ipcMain.handle('folders:getRules', (_e, id: number): FolderRules => {
    const rows = db.prepare('SELECT type, pattern FROM rules WHERE folder_id = ?').all(id) as Array<{ type: string; pattern: string }>;
    return {
      whitelist: rows.filter(r => r.type === 'whitelist').map(r => r.pattern),
      blacklist: rows.filter(r => r.type === 'blacklist').map(r => r.pattern),
    };
  });

  ipcMain.handle('folders:setRules', (_e, id: number, rules: FolderRules) => {
    const tx = db.transaction((id: number, rules: FolderRules) => {
      db.prepare('DELETE FROM rules WHERE folder_id = ?').run(id);
      const ins = db.prepare('INSERT INTO rules (folder_id, type, pattern) VALUES (?, ?, ?)');
      for (const p of rules.whitelist) if (p.trim()) ins.run(id, 'whitelist', p.trim());
      for (const p of rules.blacklist) if (p.trim()) ins.run(id, 'blacklist', p.trim());
    });
    tx(id, rules);
  });

  ipcMain.handle('folders:pickDirectory', async () => {
    const win = getMainWindow();
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('scan:run', async (_e, folderId: number, opts: ScanOptions = {}) => {
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId) as any;
    if (!folder) throw new Error('Folder not found');
    const rulesRows = db.prepare('SELECT type, pattern FROM rules WHERE folder_id = ?').all(folderId) as Array<{ type: string; pattern: string }>;
    const rules: FolderRules = {
      whitelist: rulesRows.filter(r => r.type === 'whitelist').map(r => r.pattern),
      blacklist: rulesRows.filter(r => r.type === 'blacklist').map(r => r.pattern),
    };
    await scanFolder(folderId, folder.root_path, rules, opts, p => {
      const win = getMainWindow();
      win?.webContents.send('scan:progress', p);
    });
    clearGitCache();
    return getSummary(folderId);
  });

  ipcMain.handle('scan:initBaseline', (_e, folderId: number) => {
    const tx = db.transaction((folderId: number) => {
      db.prepare('UPDATE files SET baseline_total = total WHERE folder_id = ?').run(folderId);
      db.prepare('UPDATE folders SET baseline_at = ? WHERE id = ?').run(Date.now(), folderId);
    });
    tx(folderId);
  });

  ipcMain.handle('scan:resetBaseline', (_e, folderId: number) => {
    const tx = db.transaction((folderId: number) => {
      db.prepare('UPDATE files SET baseline_total = 0 WHERE folder_id = ?').run(folderId);
      db.prepare('UPDATE folders SET baseline_at = NULL WHERE id = ?').run(folderId);
    });
    tx(folderId);
  });

  ipcMain.handle('scan:cancel', () => { cancelScan(); });

  ipcMain.handle('stats:summary', (_e, folderId: number) => getSummary(folderId));
  ipcMain.handle('stats:tree', (_e, folderId: number) => getTree(folderId));
  ipcMain.handle('stats:topFiles', (_e, folderId: number, limit?: number, sortBy?: TopFileSortKey) => getTopFiles(folderId, limit, sortBy));
  ipcMain.handle('stats:topFunctions', (_e, folderId: number, limit?: number) => getTopFunctions(folderId, limit));
  ipcMain.handle('stats:tags', (_e, folderId: number, kind?: string) => getTags(folderId, kind));
  ipcMain.handle('stats:fileTags', (_e, folderId: number, relPath: string) => getFileTags(folderId, relPath));
  ipcMain.handle('stats:heatmap', (_e, folderId: number, days?: number) => getHeatmap(folderId, days));
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
      INSERT INTO files (folder_id, rel_path, lang, ext, size, mtime, hash, total, code, comment, blank, block_comment, baseline_total, scanned_at, deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)
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
}
