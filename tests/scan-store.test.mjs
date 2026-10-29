import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { act, createElement as h } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let server;
let dom;
let root;
let createRoot;
let MemoryRouter;
let I18nProvider;
let ThemeProvider;
let TitleBar;
let ScanNowButton;
let useScanStore;
let isFolderScanning;
let isFolderQueued;
let useAppStore;
let onProgress;
let resolveScan;
let rejectScan;
let cancelCalls;
let scans;
const timers = new Map();
let timerId = 0;

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://scan.test/', pretendToBeVisual: true,
  });
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) {
    globalThis[key] = key === 'window' ? dom.window : dom.window[key];
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(window, {
    setTimeout: callback => {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout: id => timers.delete(id),
    api: {
      scan: {
        onProgress: callback => {
          onProgress = callback;
          return () => { onProgress = null; };
        },
        run: (folderId, opts) => new Promise((resolve, reject) => {
          const scan = { folderId, requestId: opts.requestId, terminal: false, settled: false };
          scan.resolve = value => { scan.settled = true; resolve(value); };
          scan.reject = error => { scan.settled = true; reject(error); };
          resolveScan = scan.resolve;
          rejectScan = scan.reject;
          scans.push(scan);
        }),
        cancel: async () => { cancelCalls += 1; },
      },
    },
  });
  ({ createRoot } = await import('react-dom/client'));
  ({ MemoryRouter } = await import('react-router-dom'));
  server = await createServer({
    configFile: false,
    esbuild: { jsx: 'automatic' },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
  });
  ({ useScanStore, isFolderScanning, isFolderQueued } = await server.ssrLoadModule('/src/renderer/store/scan-store.ts'));
  ({ useAppStore } = await server.ssrLoadModule('/src/renderer/store/app-store.ts'));
  ({ I18nProvider } = await server.ssrLoadModule('/src/renderer/i18n.tsx'));
  ({ ThemeProvider } = await server.ssrLoadModule('/src/renderer/theme.tsx'));
  ({ default: TitleBar } = await server.ssrLoadModule('/src/renderer/shell/TitleBar.tsx'));
  ({ default: ScanNowButton } = await server.ssrLoadModule('/src/renderer/components/ScanNowButton.tsx'));
});

beforeEach(() => {
  useScanStore.getState().reset();
  useScanStore.setState({ outcomeToken: 0, lastScanAt: {}, folderId: null, queuedFolderIds: [] });
  useAppStore.setState({ revision: 0 });
  timers.clear();
  cancelCalls = 0;
  scans = [];
  window.localStorage.clear();
  window.localStorage.setItem('code-line-analysis-language', 'en');
  useScanStore.getState().listen();
});

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  root = undefined;
  document.body.replaceChildren();
});

after(async () => {
  await server?.close();
  dom?.window.close();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'IS_REACT_ACT_ENVIRONMENT']) {
    delete globalThis[key];
  }
});

function progress(phase, folderId = 1, outcome) {
  const scan = scans.find(scan => scan.folderId === folderId && !scan.terminal && !scan.settled);
  if (scan && phase === 'done') scan.terminal = true;
  onProgress({ folderId, requestId: scan?.requestId, phase, outcome, total: 12, done: phase === 'done' ? 12 : 4 });
}

test('a watcher scan exits the busy state and refreshes results without a run promise', () => {
  progress('walking');
  progress('parsing');
  assert.equal(useScanStore.getState().status, 'running');
  progress('done');
  assert.equal(useScanStore.getState().status, 'idle');
  assert.equal(useScanStore.getState().progress, null);
  assert.equal(useAppStore.getState().revision, 1);
});

test('an error-shaped background terminal event stops scanning without claiming success', () => {
  progress('parsing');
  onProgress({ folderId: 1, phase: 'done', total: 0, done: 0 });
  assert.equal(useScanStore.getState().status, 'idle');
  assert.deepEqual(useScanStore.getState().lastScanAt, {});
});

test('background cancellation finishes and does not cancel the next watcher scan', () => {
  progress('walking');
  useScanStore.getState().cancel();
  assert.equal(cancelCalls, 1);
  assert.equal(useScanStore.getState().status, 'running');
  progress('done');
  assert.equal(useScanStore.getState().status, 'cancelled');
  assert.equal(useScanStore.getState().outcomeToken, 1);
  progress('walking');
  progress('done');
  assert.equal(useScanStore.getState().status, 'idle');
});

test('manual success uses the command result and refreshes only once', async () => {
  const pending = useScanStore.getState().run(1);
  progress('parsing');
  progress('done');
  assert.equal(useScanStore.getState().status, 'running');
  assert.equal(useAppStore.getState().revision, 0);
  resolveScan({ totalFiles: 10 });
  await pending;
  assert.equal(useScanStore.getState().status, 'done');
  assert.equal(useScanStore.getState().filesScanned, 10);
  assert.equal(useScanStore.getState().outcomeToken, 1);
  assert.equal(useAppStore.getState().revision, 1);
  for (const callback of timers.values()) callback();
  assert.equal(useScanStore.getState().status, 'idle');
});

test('manual failures remain errors after a terminal progress event', async () => {
  const pending = useScanStore.getState().run(1);
  progress('parsing');
  progress('done');
  rejectScan(new Error('Scan failed'));
  await pending;
  assert.equal(useScanStore.getState().status, 'error');
  assert.equal(useScanStore.getState().error, 'Scan failed');
  assert.equal(useAppStore.getState().revision, 0);
});

test('cancellation racing with a successful commit still refreshes committed results', async () => {
  const pending = useScanStore.getState().run(1);
  progress('parsing');
  useScanStore.getState().cancel();
  progress('done');
  resolveScan({ totalFiles: 10 });
  await pending;
  assert.equal(useScanStore.getState().status, 'done');
  assert.ok(useScanStore.getState().lastScanAt[1] > 0);
  assert.equal(useAppStore.getState().revision, 1);
  progress('walking');
  progress('done');
  assert.equal(useScanStore.getState().status, 'idle');
});

test('a backend cancellation reply remains cancelled without refreshing rolled-back data', async () => {
  const pending = useScanStore.getState().run(1);
  progress('persisting');
  useScanStore.getState().cancel();
  progress('done', 1, 'cancelled');
  rejectScan(new Error('Scan cancelled'));
  await pending;
  assert.equal(useScanStore.getState().status, 'cancelled');
  assert.deepEqual(useScanStore.getState().lastScanAt, {});
  assert.equal(useAppStore.getState().revision, 0);
});

test('background success records scan time even for an empty repository', () => {
  onProgress({ folderId: 1, phase: 'done', outcome: 'success', total: 0, done: 0 });
  assert.ok(useScanStore.getState().lastScanAt[1] > 0);
  assert.equal(useAppStore.getState().revision, 1);
});

test('explicit background errors stop scanning without publishing success or refreshing data', () => {
  progress('walking');
  onProgress({ folderId: 1, phase: 'done', outcome: 'error', total: 0, done: 0 });
  assert.equal(useScanStore.getState().status, 'error');
  assert.deepEqual(useScanStore.getState().lastScanAt, {});
  assert.equal(useAppStore.getState().revision, 0);
});

test('bulk repository requests all enter the backend queue and each refreshes once', async () => {
  const pending = [1, 2, 3].map(id => useScanStore.getState().run(id));
  assert.deepEqual(scans.map(scan => scan.folderId), [1, 2, 3]);
  assert.deepEqual(useScanStore.getState().queuedFolderIds, [1, 2, 3]);
  for (let index = 0; index < scans.length; index += 1) {
    const { folderId, resolve } = scans[index];
    progress('parsing', folderId);
    progress('done', folderId, 'success');
    resolve({ totalFiles: 12 });
    await pending[index];
    assert.equal(useAppStore.getState().revision, index + 1);
    assert.ok(useScanStore.getState().lastScanAt[folderId] > 0);
    assert.deepEqual(useScanStore.getState().queuedFolderIds, [1, 2, 3].slice(index + 1));
  }
  assert.equal(useScanStore.getState().status, 'done');
});

test('a queued repeat for the same folder keeps running when the earlier reply settles', async () => {
  const first = useScanStore.getState().run(1);
  const second = useScanStore.getState().run(1);
  progress('parsing');
  progress('done', 1, 'success');
  progress('walking');
  scans[0].resolve({ totalFiles: 12 });
  await first;
  assert.equal(useScanStore.getState().status, 'running');
  assert.equal(useScanStore.getState().progress.phase, 'walking');
  progress('done', 1, 'success');
  scans[1].resolve({ totalFiles: 12 });
  await second;
  assert.equal(useAppStore.getState().revision, 2);
  assert.equal(useScanStore.getState().status, 'done');
});

test('a background scan finishing ahead of a queued manual scan keeps the manual scan pending', async () => {
  const pending = useScanStore.getState().run(2);
  progress('walking', 1);
  progress('done', 1);
  assert.equal(useScanStore.getState().status, 'queued');
  assert.equal(useScanStore.getState().folderId, 2);
  progress('parsing', 2);
  progress('done', 2);
  resolveScan({ totalFiles: 10 });
  await pending;
  assert.equal(useScanStore.getState().status, 'done');
  assert.equal(useScanStore.getState().folderId, 2);
  assert.equal(useAppStore.getState().revision, 2);
});

test('background completion for the same repository cannot settle or steal a queued manual request', async () => {
  const pending = useScanStore.getState().run(1);
  onProgress({ folderId: 1, phase: 'walking', total: 12, done: 0 });
  onProgress({ folderId: 1, phase: 'done', outcome: 'success', total: 12, done: 12 });
  assert.equal(useScanStore.getState().status, 'queued');
  assert.deepEqual(useScanStore.getState().queuedFolderIds, [1]);
  assert.equal(useAppStore.getState().revision, 1);
  progress('parsing');
  progress('done', 1, 'success');
  scans[0].resolve({ totalFiles: 12 });
  await pending;
  assert.equal(useScanStore.getState().status, 'done');
  assert.equal(useAppStore.getState().revision, 2);
});

test('another repository repeatedly scanning does not change the current folder scan control', () => {
  for (let scan = 0; scan < 20; scan += 1) {
    progress('walking', 45);
    assert.equal(isFolderScanning(useScanStore.getState(), 60), false);
    assert.equal(isFolderScanning(useScanStore.getState(), 45), true);
    progress('done', 45);
    assert.equal(isFolderScanning(useScanStore.getState(), 60), false);
  }
  assert.equal(isFolderScanning(useScanStore.getState(), null), false);
});

test('the current folder control follows its own queued, running and finished states', async () => {
  const pending = useScanStore.getState().run(60);
  assert.equal(isFolderScanning(useScanStore.getState(), 60), true);
  progress('parsing', 60);
  assert.equal(isFolderScanning(useScanStore.getState(), 60), true);
  assert.equal(isFolderScanning(useScanStore.getState(), 45), false);
  progress('done', 60);
  resolveScan({ totalFiles: 10 });
  await pending;
  assert.equal(isFolderScanning(useScanStore.getState(), 60), false);
});

test('a current-folder request remains queued while another repository scans', async () => {
  progress('walking', 45);
  const pending = useScanStore.getState().run(60);
  assert.equal(useScanStore.getState().folderId, 45);
  assert.equal(useScanStore.getState().status, 'running');
  assert.equal(isFolderScanning(useScanStore.getState(), 45), true);
  assert.equal(isFolderScanning(useScanStore.getState(), 60), true);
  assert.equal(isFolderQueued(useScanStore.getState(), 45), false);
  assert.equal(isFolderQueued(useScanStore.getState(), 60), true);
  progress('done', 45, 'success');
  assert.equal(isFolderQueued(useScanStore.getState(), 60), true);
  progress('walking', 60);
  assert.equal(isFolderQueued(useScanStore.getState(), 60), false);
  progress('done', 60, 'success');
  scans[0].resolve({ totalFiles: 12 });
  await pending;
  assert.equal(isFolderScanning(useScanStore.getState(), 60), false);
});

async function mountControls() {
  const folders = [45, 60].map(id => ({
    id, name: `Repository ${id}`, rootPath: `/projects/${id}`, createdAt: 0, isAvailable: true,
  }));
  useAppStore.setState({
    folders, activeFolderId: 60, detectDuplicatesOnScan: true,
    repoInfoByFolder: { 45: null, 60: null },
  });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(h(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } },
      h(I18nProvider, null, h(ThemeProvider, null,
        h('div', { 'data-titlebar': true }, h(TitleBar)),
        h('div', { 'data-scan-now': true }, h(ScanNowButton, { folderId: 60 }))))));
  });
}

function rescanButton() {
  return document.querySelector('[data-titlebar] button[aria-label="Rescan"]');
}

function scanNowButton() {
  return document.querySelector('[data-scan-now] button');
}

function cancelButton() {
  return [...document.querySelectorAll('[data-titlebar] button')].find(node => node.textContent.trim() === 'Cancel scan');
}

test('Rescan stays available during another scan, queues once and cannot cancel that scan', async () => {
  progress('walking', 45);
  await mountControls();
  const rescan = rescanButton();
  const scanNow = scanNowButton();
  assert.ok(rescan);
  assert.equal(rescan.disabled, false);
  assert.equal(scanNow.disabled, false);
  await act(async () => { rescan.click(); rescan.click(); scanNow.click(); });
  assert.deepEqual(scans.map(scan => scan.folderId), [60]);
  assert.equal(useScanStore.getState().folderId, 45);
  assert.equal(cancelButton(), undefined);
  assert.equal(scanNowButton().disabled, true);
  assert.equal(scanNowButton().textContent.trim(), 'Scan queued');
  const waiting = [...document.querySelectorAll('[data-titlebar] button')]
    .find(node => node.textContent.trim() === 'Scan queued');
  assert.ok(waiting);
  assert.equal(waiting.disabled, true);
  await act(async () => { waiting.click(); scanNowButton().click(); });
  assert.equal(cancelCalls, 0);
  assert.equal(scans.length, 1);
  await act(async () => { progress('done', 45, 'success'); progress('walking', 60); });
  assert.ok(cancelButton());
  await act(async () => { cancelButton().click(); });
  assert.equal(cancelCalls, 1);
  await act(async () => {
    progress('done', 60, 'cancelled');
    scans[0].reject(new Error('Scan cancelled'));
  });
  assert.equal(rescanButton().disabled, false);
  assert.equal(scanNowButton().disabled, false);
});

test('Scan now queues the current repository during unrelated work and prevents duplicate clicks', async () => {
  progress('walking', 45);
  await mountControls();
  const scanNow = scanNowButton();
  assert.equal(scanNow.disabled, false);
  await act(async () => { scanNow.click(); scanNow.click(); });
  assert.equal(scans.length, 1);
  assert.equal(scans[0].folderId, 60);
  assert.equal(scanNowButton().disabled, true);
  assert.equal(scanNowButton().textContent.trim(), 'Scan queued');
  assert.equal(cancelButton(), undefined);
  await act(async () => {
    progress('done', 45, 'success');
    progress('parsing', 60);
    progress('done', 60, 'success');
    scans[0].resolve({ totalFiles: 12 });
  });
  assert.equal(scanNowButton().disabled, false);
  assert.equal(scanNowButton().textContent.trim(), 'Scan now');
});
