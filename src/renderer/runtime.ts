import { createBrowserApi, stageBrowserDropImport } from './web/api';

declare global {
  interface Window {
    __codeLineRuntime?: 'electron' | 'web';
  }
}

export function ensureRuntimeApi(): void {
  if (typeof window.api === 'undefined') {
    window.api = createBrowserApi();
    window.__codeLineRuntime = 'web';
    return;
  }

  window.__codeLineRuntime = 'electron';
}

export function isWebRuntime(): boolean {
  return window.__codeLineRuntime === 'web';
}

export async function stageDroppedFolderImport(dataTransfer: DataTransfer): Promise<string | null> {
  if (!isWebRuntime()) return null;
  return stageBrowserDropImport(dataTransfer);
}