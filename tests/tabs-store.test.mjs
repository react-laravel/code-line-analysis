import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createServer } from 'vite';

let server;
let useTabsStore;
const saved = new Map();

before(async () => {
  globalThis.window = { localStorage: {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  } };
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
  });
  ({ useTabsStore } = await server.ssrLoadModule('/src/renderer/store/tabs-store.ts'));
});

beforeEach(() => {
  saved.clear();
  useTabsStore.setState({ fileTabsByFolder: {}, recentByFolder: {}, pendingClose: null });
});

after(async () => { await server?.close(); delete globalThis.window; });

function fileTab() { return useTabsStore.getState().fileTabsByFolder[1][0]; }

test('an unsaved buffer retains its opening disk hash across subsequent loads and edits', () => {
  const store = useTabsStore.getState();
  const tab = store.openFile(1, 'a.ts');
  store.setDraft(tab.id, 'my draft', 'original-hash');
  store.openFile(1, 'a.ts', '?line=12');
  store.setDraft(tab.id, 'revised draft', 'externally-modified-hash');
  assert.equal(fileTab().draft, 'revised draft');
  assert.equal(fileTab().originalHash, 'original-hash');
});

test('edit mode survives navigation and persistence without persisting unsaved buffers', () => {
  const store = useTabsStore.getState();
  const tab = store.openFile(1, 'a.ts');
  store.setDraft(tab.id, 'my draft', 'original-hash');
  store.setReadOnly(tab.id, false);
  store.openFile(1, 'a.ts', '?line=12');
  assert.equal(fileTab().readOnly, false);
  const persisted = JSON.parse(saved.get('code-line-analysis-file-tabs'))[1][0];
  assert.equal(persisted.readOnly, false);
  assert.equal(persisted.draft, undefined);
  assert.equal(persisted.originalHash, undefined);
});

test('a late successful save clears the saved draft even after navigating away', () => {
  const store = useTabsStore.getState();
  const tab = store.openFile(1, 'a.ts');
  store.setDraft(tab.id, 'saved content', 'opening-hash');
  store.openFile(1, 'b.ts');
  store.markSaved(tab.id, 'saved content', 'saved-hash');
  assert.equal(fileTab().draft, undefined);
  assert.equal(fileTab().originalHash, undefined);
});

test('typing during a save retains the newer draft and advances its comparison version', () => {
  const store = useTabsStore.getState();
  const tab = store.openFile(1, 'a.ts');
  store.setDraft(tab.id, 'submitted content', 'opening-hash');
  store.setDraft(tab.id, 'newer content', 'opening-hash');
  store.markSaved(tab.id, 'submitted content', 'saved-hash');
  assert.equal(fileTab().draft, 'newer content');
  assert.equal(fileTab().originalHash, 'saved-hash');
});
