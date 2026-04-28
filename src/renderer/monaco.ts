import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

type WorkerCtor = new () => Worker;

const workers: Record<string, WorkerCtor> = {
  json: jsonWorker,
  css: cssWorker,
  scss: cssWorker,
  less: cssWorker,
  html: htmlWorker,
  handlebars: htmlWorker,
  razor: htmlWorker,
  typescript: tsWorker,
  javascript: tsWorker,
};

const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (_workerId: string, label: string) => Worker;
  };
};

monacoGlobal.MonacoEnvironment = {
  getWorker(_workerId, label) {
    const WorkerImpl = workers[label] ?? editorWorker;
    return new WorkerImpl();
  },
};

// In Electron the default loader falls back to an external CDN, which is blocked
// by our CSP and leaves the editor stuck on the Loading state. Use local assets.
loader.config({ monaco });