import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createServer } from 'vite';

let server;
let useScanStore;
let useAppStore;
let onProgress;
let resolveScan;
let rejectScan;
let cancelCalls;
const timers = new Map();
let timerId = 0;

before(async () => {
  globalThis.window = {
    localStorage: { getItem: () => null, setItem: () => {} },
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
        run: () => new Promise((resolve, reject) => {
          resolveScan = resolve;
          rejectScan = reject;
        }),
        cancel: async () => { cancelCalls += 1; },
      },
    },
  };
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
  });
  ({ useScanStore } = await server.ssrLoadModule('/src/renderer/store/scan-store.ts'));
  ({ useAppStore } = await server.ssrLoadModule('/src/renderer/store/app-store.ts'));
});

beforeEach(() => {
  useScanStore.getState().reset();
  useScanStore.setState({ outcomeToken: 0, lastScanAt: {}, folderId: null });
  useAppStore.setState({ revision: 0 });
  timers.clear();
  cancelCalls = 0;
  useScanStore.getState().listen();
});

after(async () => {
  await server?.close();
  delete globalThis.window;
});

function progress(phase, folderId = 1) {
  onProgress({ folderId, phase, total: 12, done: phase === 'done' ? 12 : 4 });
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

test('manual cancellation remains cancelled when the command resolves', async () => {
  const pending = useScanStore.getState().run(1);
  progress('parsing');
  useScanStore.getState().cancel();
  progress('done');
  resolveScan({ totalFiles: 10 });
  await pending;
  assert.equal(useScanStore.getState().status, 'cancelled');
  assert.deepEqual(useScanStore.getState().lastScanAt, {});
  progress('walking');
  progress('done');
  assert.equal(useScanStore.getState().status, 'idle');
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
