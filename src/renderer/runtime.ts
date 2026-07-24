import { createTauriApi, isTauriRuntime } from './runtime/tauri-api';

declare global {
  interface Window {
    __codeLineRuntime?: 'tauri';
  }
}

/** Desktop shell only — requires Tauri runtime. */
export function ensureRuntimeApi(): void {
  if (!isTauriRuntime()) {
    throw new Error('Code Line Analysis requires the Tauri desktop runtime. Run `npm run dev`.');
  }
  window.api = createTauriApi();
  window.__codeLineRuntime = 'tauri';
}
