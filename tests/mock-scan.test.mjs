import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { createServer } from 'vite';

let server, createMockApi, api, progress, unlisten;
const intervals = new Map();
let timerId = 0;
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

before(async () => {
  globalThis.window = {
    setInterval(callback) { intervals.set(++timerId, callback); return timerId; },
    clearInterval(id) { intervals.delete(id); },
  };
  server = await createServer({
    configFile: false, appType: 'custom',
    resolve: { alias: { '@shared': path.resolve('src/shared') } },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ createMockApi } = await server.ssrLoadModule('/src/renderer/runtime/mock-api.ts'));
});
beforeEach(() => { unlisten?.(); api = createMockApi(); progress = []; unlisten = api.scan.onProgress(event => progress.push(event)); });
after(async () => { unlisten?.(); await server.close(); delete globalThis.window; });

function finishCurrentScan() {
  for (let tick = 0; tick < 50 && intervals.size > 0; tick += 1) {
    for (const callback of [...intervals.values()]) callback();
  }
}

test('mock scans serialize all requests and carry each request identity through success', async () => {
  const first = api.scan.run(1, { requestId: 'first' });
  const second = api.scan.run(2, { requestId: 'second' });
  await nextTurn();
  assert.equal(intervals.size, 1);
  finishCurrentScan();
  await first;
  assert.ok(progress.every(event => event.requestId === 'first'));
  assert.equal(progress.at(-1).outcome, 'success');
  await nextTurn();
  assert.equal(intervals.size, 1);
  finishCurrentScan();
  await second;
  const terminal = progress.filter(event => event.phase === 'done');
  assert.deepEqual(terminal.map(event => [event.requestId, event.outcome]), [['first', 'success'], ['second', 'success']]);
});

test('mock cancellation rejects the active job and leaves its queued successor available', async () => {
  const first = api.scan.run(1, { requestId: 'cancelled' });
  const rejected = assert.rejects(first, /Scan cancelled/);
  const second = api.scan.run(2, { requestId: 'next' });
  await nextTurn();
  await api.scan.cancel();
  await rejected;
  assert.deepEqual(progress.filter(event => event.phase === 'done').map(event => event.outcome), ['cancelled']);
  await nextTurn();
  finishCurrentScan();
  await second;
  assert.equal(progress.at(-1).requestId, 'next');
  assert.equal(progress.at(-1).outcome, 'success');
});

test('mock duplicate preference round-trips rather than reverting to its default', async () => {
  await api.settings.setDetectDuplicates(false);
  assert.equal(await api.settings.getDetectDuplicates(), false);
  await api.settings.setDetectDuplicates(true);
  assert.equal(await api.settings.getDetectDuplicates(), true);
});
