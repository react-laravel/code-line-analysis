import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server;
let loadFileIndex;
before(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  ({ loadFileIndex } = await server.ssrLoadModule('/src/renderer/lib/file-index.ts'));
});
after(async () => { await server?.close(); delete globalThis.window; });

const row = index => ({ relPath: `src/${String(index).padStart(5, '0')}.rs`, total: 1, code: 1, size: 10, lang: 'Rust', lastCommitDate: null });

test('loads every file beyond the old 5000-row ceiling using bounded pages', async () => {
  const all = Array.from({ length: 6105 }, (_, i) => row(i));
  const offsets = [];
  globalThis.window = { api: { stats: { filesPage: async (id, offset, limit) => {
    assert.equal(id, 7); assert.equal(limit, 1000); offsets.push(offset);
    return { rows: all.slice(offset, offset + limit), total: all.length, revision: 4 };
  } } } };
  const rows = await loadFileIndex(7);
  assert.equal(rows.length, 6105);
  assert.equal(rows.at(-1).relPath, 'src/06104.rs');
  assert.deepEqual(offsets, [0, 1000, 2000, 3000, 4000, 5000, 6000]);
});

test('restarts a mixed-revision index rather than silently losing files', async () => {
  let calls = 0;
  globalThis.window = { api: { stats: { filesPage: async (_id, offset) => {
    calls += 1;
    if (calls === 1) return { rows: [row(0)], total: 2, revision: 1 };
    if (calls === 2) return { rows: [row(1)], total: 2, revision: 2 };
    assert.equal(offset, 0);
    return { rows: [row(2), row(3)], total: 2, revision: 2 };
  } } } };
  assert.deepEqual((await loadFileIndex(1)).map(item => item.relPath), ['src/00002.rs', 'src/00003.rs']);
});

test('dates cover small files and preserve unknown dates', async () => {
  globalThis.window = { api: { stats: {
    filesPage: async () => ({ rows: [row(6000), row(6001)], total: 2, revision: 3 }),
    fileDates: async () => ({ dates: { 'src/06000.rs': 100 }, revision: 3 }),
  } } };
  assert.deepEqual((await loadFileIndex(1, true)).map(item => item.lastCommitDate), [100, null]);
});

test('an empty intermediate page is a failure instead of a partial full index', async () => {
  globalThis.window = { api: { stats: { filesPage: async () => ({ rows: [], total: 1, revision: 3 }) } } };
  await assert.rejects(loadFileIndex(1), /Incomplete file index/);
});

test('a scan finishing during the date lookup retries the entire index', async () => {
  let attempt = 0;
  globalThis.window = { api: { stats: {
    filesPage: async () => ({ rows: [row(++attempt)], total: 1, revision: attempt }),
    fileDates: async () => ({ dates: { [row(attempt).relPath]: 100 }, revision: 2 }),
  } } };
  const rows = await loadFileIndex(1, true);
  assert.equal(attempt, 2);
  assert.equal(rows[0].relPath, row(2).relPath);
  assert.equal(rows[0].lastCommitDate, 100);
});
