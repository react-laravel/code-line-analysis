import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import React, { act, createElement as h } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let dom, server, createRoot, MemoryRouter, Explorer, DataTable, I18nProvider, useAppStore;
let root, contextRequests;
let useDuplicatesLens;
const folder = { id: 1, name: 'Huge repository', rootPath: '/test', createdAt: 0, isAvailable: true };
const tree = {
  name: '', path: '', isDir: true, total: 10000, code: 10000, comment: 0, blank: 0, files: 10000,
  children: Array.from({ length: 10000 }, (_, i) => ({
    name: `file-${String(i).padStart(5, '0')}.ts`, path: `file-${String(i).padStart(5, '0')}.ts`,
    isDir: false, total: 1, code: 1, comment: 0, blank: 0, files: 1,
  })),
};

before(async () => {
  dom = new JSDOM('<html><body></body></html>', { url: 'https://lists.test', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) {
    globalThis[key] = key === 'window' ? dom.window : dom.window[key];
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 260; } });
  ({ createRoot } = await import('react-dom/client'));
  ({ MemoryRouter } = await import('react-router-dom'));
  server = await createServer({
    configFile: false, esbuild: { jsx: 'automatic' }, appType: 'custom',
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ default: Explorer } = await server.ssrLoadModule('/src/renderer/shell/Explorer.tsx'));
  ({ DataTable } = await server.ssrLoadModule('/src/renderer/components/ui/table.tsx'));
  ({ I18nProvider } = await server.ssrLoadModule('/src/renderer/i18n.tsx'));
  ({ useAppStore } = await server.ssrLoadModule('/src/renderer/store/app-store.ts'));
  ({ useDuplicatesLens } = await server.ssrLoadModule('/src/renderer/views/code/DuplicatesLens.tsx'));
});

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('code-line-analysis-language', 'en');
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  contextRequests = [];
  window.api = {
    stats: { tree: async () => tree },
    system: { showTreeNodeContextMenu: async request => { contextRequests.push(request); } },
  };
  useAppStore.setState({ folders: [folder], activeFolderId: 1, explorerTree: null, expandedTreePathsByFolder: {}, revision: 0 });
});
afterEach(async () => { await act(async () => { root.unmount(); }); });
after(async () => { await server.close(); dom.window.close(); delete globalThis.window; });

async function renderExplorer(collapsed = false) {
  await act(async () => { root.render(h(MemoryRouter, {
    future: { v7_startTransition: true, v7_relativeSplatPath: true },
  }, h(I18nProvider, null, h(Explorer, { collapsed })))); });
}

async function scroll(node, top) {
  await act(async () => { node.scrollTop = top; node.dispatchEvent(new window.Event('scroll')); });
}

test('a 10000-row table mounts a bounded window and can reach the final row', async () => {
  const activated = [];
  await act(async () => { root.render(h(DataTable, {
    virtual: true, rows: tree.children,
    columns: [{ id: 'name', header: 'Name', cell: row => row.name }],
    rowKey: row => row.path, 'aria-label': 'Files',
    onRowActivate: row => activated.push(row.path),
  })); });
  const table = document.querySelector('table');
  assert.equal(table.getAttribute('aria-rowcount'), '10001');
  assert.ok(table.querySelectorAll('tbody tr').length < 70);
  assert.equal(table.textContent.includes('file-09999.ts'), false);
  await act(async () => {
    const first = table.querySelector('[data-table-index="0"]');
    first.focus();
    first.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    await new Promise(resolve => window.requestAnimationFrame(resolve));
  });
  assert.equal(document.activeElement.getAttribute('data-table-index'), '9999');
  await act(async () => { document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  assert.deepEqual(activated, ['file-09999.ts']);
  await scroll(table.parentElement, 9999 * 30);
  assert.equal(table.textContent.includes('file-09999.ts'), true);
  assert.ok(table.querySelectorAll('tbody tr').length < 70);
});

test('virtual tree End focuses the final file and its context menu uses that file', async () => {
  await renderExplorer();
  const list = document.querySelector('[role="tree"]');
  assert.ok(list.querySelectorAll('[role="treeitem"]').length < 70);
  await act(async () => {
    list.querySelector('[role="treeitem"]').focus();
    list.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    await new Promise(resolve => window.requestAnimationFrame(resolve));
  });
  assert.equal(document.activeElement.getAttribute('title'), 'file-09999.ts — 1 Lines');
  await act(async () => { document.activeElement.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
  assert.equal(contextRequests.length, 1);
  assert.equal(contextRequests[0].relPath, 'file-09999.ts');
  assert.equal(contextRequests[0].folderId, 1);
  assert.ok(list.querySelectorAll('[role="treeitem"]').length < 70);
});

test('restoring a collapsed large explorer reattaches virtualization to its new viewport', async () => {
  await renderExplorer();
  await renderExplorer(true);
  assert.equal(document.querySelector('[role="tree"]'), null);
  await renderExplorer(false);
  const list = document.querySelector('[role="tree"]');
  const first = list.querySelector('[role="treeitem"]').textContent;
  await scroll(list.parentElement, 5000 * 26);
  assert.notEqual(list.querySelector('[role="treeitem"]').textContent, first);
  assert.equal(list.textContent.includes('file-04999.ts'), true);
  assert.ok(list.querySelectorAll('[role="treeitem"]').length < 70);
});

test('duplicate totals use actual occurrence ranges and large groups start collapsed', async () => {
  window.api.stats.duplicates = async () => [
    { hash: 'a', lines: 5, occurrences: [
      { relPath: 'a.ts', startLine: 1, endLine: 3 }, { relPath: 'b.ts', startLine: 1, endLine: 5 },
    ] },
    { hash: 'b', lines: 3, occurrences: [
      { relPath: 'c.ts', startLine: 1, endLine: 3 }, { relPath: 'd.ts', startLine: 1, endLine: 3 },
    ] },
  ];
  window.api.folders = { getDuplicateMinLines: async () => 8 };
  function DuplicatesHarness() {
    const lens = useDuplicatesLens({ folder, active: true, query: '', clearQuery() {} });
    return h('div', null, lens.subtitle, lens.filters, lens.content);
  }
  await act(async () => { root.render(h(MemoryRouter, {
    future: { v7_startTransition: true, v7_relativeSplatPath: true },
  }, h(I18nProvider, null, h(DuplicatesHarness)))); });
  assert.match(document.body.textContent, /Repeated Lines14/);
  assert.match(document.body.textContent, /last completed scan/);
  const groups = [...document.querySelectorAll('button[aria-expanded]')];
  assert.deepEqual(groups.map(group => group.getAttribute('aria-expanded')), ['true', 'false']);
  assert.equal(document.body.textContent.includes('c.ts'), false);
  await act(async () => { groups[1].click(); });
  assert.equal(document.body.textContent.includes('c.ts'), true);
});
