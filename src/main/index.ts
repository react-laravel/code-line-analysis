import { app, BrowserWindow, shell } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getDb, closeDb } from './db';
import { registerIpc } from './ipc';

let mainWindow: BrowserWindow | null = null;

function resolveAppIconPath(): string | undefined {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'build', 'icon.png');

  return existsSync(iconPath) ? iconPath : undefined;
}

function createWindow(): void {
  const iconPath = resolveAppIconPath();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Code Line Analysis',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // sandbox=true breaks our preload requiring no node, kept false for IPC simplicity
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  getDb();
  registerIpc(() => mainWindow);

  const iconPath = resolveAppIconPath();
  const dock = process.platform === 'darwin' ? app.dock : undefined;
  if (dock && iconPath) {
    dock.setIcon(iconPath);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { closeDb(); });
