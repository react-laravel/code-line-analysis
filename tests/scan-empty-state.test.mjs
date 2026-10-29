import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import React, { act, createElement as h } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let dom, server, createRoot, MemoryRouter, OverviewView, Explorer, I18nProvider, useAppStore, useScanStore;
let root, summaryResult, treeResult, scanCalls;
const folder = { id: 1, name: 'Selected repository', rootPath: '/test/selected', createdAt: 0, isAvailable: true };
const otherFolder = { ...folder, id: 2, name: 'Other repository', rootPath: '/test/other' };
const emptySummary = {
  totalFiles: 0, totalLines: 0, totalCode: 0, runtimeCode: 0, testCode: 0,
  totalComment: 0, totalBlank: 0, totalBlockComment: 0, byLang: [], tagCounts: {},
};
const emptyTree = { name: '', path: '', isDir: true, total: 0, code: 0, comment: 0, blank: 0, files: 0, children: [] };
const populatedSummary = {
  totalFiles: 1, totalLines: 14, totalCode: 10, runtimeCode: 10, testCode: 0,
  totalComment: 3, totalBlank: 1, totalBlockComment: 2,
  byLang: [{ lang: 'TypeScript', files: 1, total: 14, code: 10, comment: 3, blank: 1 }],
  tagCounts: { TODO: 1 },
};
const populatedTree = {
  ...emptyTree, total: 14, code: 10, comment: 3, blank: 1, files: 1,
  children: [{ name: 'index.ts', path: 'index.ts', isDir: false, total: 14, code: 10, comment: 3, blank: 1, files: 1 }],
};

before(async () => {
  dom = new JSDOM('<html><body></body></html>', { url: 'https://scan-empty.test', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) {
    globalThis[key] = key === 'window' ? dom.window : dom.window[key];
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
  ({ createRoot } = await import('react-dom/client'));
  ({ MemoryRouter } = await import('react-router-dom'));
  server = await createServer({
    configFile: false, esbuild: { jsx: 'automatic' }, appType: 'custom',
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{
      name: 'scan-empty-state-chart-boundary',
      transform(source, id) {
        if (!id.split('?')[0].endsWith('/src/renderer/components/ui/chart.tsx')) return;
        // Keep chart presence and its accessible table observable without asking
        // JSDOM to paint an ECharts canvas. All view/data-loading code stays real.
        return {
          code: `import { createElement as h } from 'react';
            export const useChartTokens = () => ({});
            export function Chart({ ariaLabel, tableFallback }) {
              return h('figure', null, h('div', { role: 'img', 'aria-label': ariaLabel }), tableFallback);
            }`,
          map: null,
        };
      },
    }],
  });
  ({ default: OverviewView } = await server.ssrLoadModule('/src/renderer/views/OverviewView.tsx'));
  ({ default: Explorer } = await server.ssrLoadModule('/src/renderer/shell/Explorer.tsx'));
  ({ I18nProvider } = await server.ssrLoadModule('/src/renderer/i18n.tsx'));
  ({ useAppStore } = await server.ssrLoadModule('/src/renderer/store/app-store.ts'));
  ({ useScanStore } = await server.ssrLoadModule('/src/renderer/store/scan-store.ts'));
});

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('code-line-analysis-language', 'en');
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  summaryResult = emptySummary;
  treeResult = emptyTree;
  scanCalls = [];
  window.api = {
    stats: { summary: async () => summaryResult, tree: async () => treeResult },
    scan: {
      run: async (folderId, options) => { scanCalls.push({ folderId, options }); return summaryResult; },
    },
  };
  useScanStore.getState().reset();
  useScanStore.setState({
    status: 'idle', folderId: null, progress: null, queuedFolderIds: [],
    lastScanAt: {}, outcomeToken: 0, durationMs: null, filesScanned: null,
  });
  useAppStore.setState({
    folders: [folder, otherFolder], activeFolderId: folder.id, revision: 0,
    explorerTree: null, expandedTreePathsByFolder: {}, activityOpenByFolder: {},
    detectDuplicatesOnScan: true,
  });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  useScanStore.getState().reset();
});
after(async () => { await server?.close(); dom?.window.close(); delete globalThis.window; });

async function renderViews() {
  await act(async () => {
    root.render(h(MemoryRouter, {
      future: { v7_startTransition: true, v7_relativeSplatPath: true },
    }, h(I18nProvider, null,
      h('main', { id: 'overview' }, h(OverviewView, { folder })),
      h('aside', { id: 'explorer' }, h(Explorer, { collapsed: false })),
    )));
  });
}

function viewNodes() {
  return [document.getElementById('overview'), document.getElementById('explorer')];
}

function scanButton(view) {
  return [...view.querySelectorAll('button')].find(button => /Scan now|Scan queued|Scan status/.test(button.textContent));
}

function assertEmptyPresentation() {
  const [overview, explorer] = viewNodes();
  assert.equal(overview.querySelector('[role="img"]'), null, 'empty results must not render language charts');
  assert.equal(overview.querySelector('table'), null, 'empty results must not render an empty language table');
  assert.doesNotMatch(overview.textContent, /Total Lines|Total Code|Runtime Code/, 'empty results must not render zero metric tiles');
  assert.equal(explorer.querySelector('[role="tree"]'), null, 'empty results must not render a zero-count root');
  assert.equal(explorer.querySelector('[aria-label="Current Directory"]'), null, 'empty results must not render root breadcrumbs');
}

test('an unscanned repository explains the missing results instead of showing zeros', async () => {
  await renderViews();
  for (const view of viewNodes()) {
    assert.match(view.textContent, /No scan results yet/);
    assert.match(view.textContent, /Scan this repository to load file and line statistics\./);
    assert.equal(scanButton(view)?.disabled, false);
  }
  assertEmptyPresentation();
  assert.deepEqual(scanCalls, [], 'showing empty results must not start a scan without a user action');
});

test('a selected repository queued behind another scan explains that its results are pending', async () => {
  useScanStore.setState({
    status: 'running', folderId: otherFolder.id, queuedFolderIds: [otherFolder.id, folder.id],
    progress: { folderId: otherFolder.id, phase: 'parsing', total: 100, done: 30 },
  });
  await renderViews();
  for (const view of viewNodes()) {
    assert.match(view.textContent, /Waiting to scan/);
    assert.match(view.textContent, /This repository is in the scan queue\. Results will appear when its scan finishes\./);
    assert.doesNotMatch(view.textContent, /No scan results yet|Scanning this repository/);
    assert.equal(scanButton(view)?.disabled, true);
  }
  assertEmptyPresentation();
});

test('a scan in progress tells the user that results arrive on completion', async () => {
  useScanStore.setState({
    status: 'running', folderId: folder.id, queuedFolderIds: [folder.id],
    progress: { folderId: folder.id, phase: 'parsing', total: 100, done: 30 },
  });
  await renderViews();
  for (const view of viewNodes()) {
    assert.match(view.textContent, /Scanning this repository/);
    assert.match(view.textContent, /Results will appear when the scan finishes\./);
    assert.doesNotMatch(view.textContent, /Waiting to scan|No scan results yet/);
    assert.equal(scanButton(view)?.disabled, true);
  }
  assertEmptyPresentation();
});

test('a completed empty scan points to scan rules and offers a rescan', async () => {
  useScanStore.setState({ lastScanAt: { [folder.id]: Date.now() } });
  await renderViews();
  for (const view of viewNodes()) {
    assert.match(view.textContent, /No matching files/);
    assert.match(view.textContent, /The scan completed without matching files\. Check the scan rules and rescan\./);
    assert.equal(scanButton(view)?.disabled, false);
  }
  assertEmptyPresentation();
});

test('scan completion replaces the empty presentation with real statistics and files', async () => {
  await renderViews();
  summaryResult = populatedSummary;
  treeResult = populatedTree;
  await act(async () => {
    useScanStore.setState({ lastScanAt: { [folder.id]: Date.now() } });
    useAppStore.getState().bumpRevision();
  });
  const [overview, explorer] = viewNodes();
  assert.match(overview.textContent, /Files1Total Lines14Total Code10/);
  assert.match(overview.querySelector('table').textContent, /TypeScript/);
  assert.equal(overview.querySelectorAll('[role="img"]').length, 2);
  assert.match(explorer.querySelector('[role="tree"]').textContent, /index\.ts/);
  assert.match(explorer.querySelector('[role="treeitem"]').getAttribute('title'), /14 Lines · 1 Files/);
  for (const view of viewNodes()) assert.doesNotMatch(view.textContent, /No scan results yet|No matching files/);

  await act(async () => {
    useScanStore.setState({ status: 'queued', folderId: folder.id, queuedFolderIds: [folder.id] });
  });
  assert.match(overview.textContent, /Total Lines14/);
  assert.match(explorer.querySelector('[role="tree"]').textContent, /index\.ts/);
  for (const view of viewNodes()) assert.doesNotMatch(view.textContent, /Waiting to scan/, 'an existing result stays visible during rescan');
});

test('the empty overview action scans the selected repository with the configured options', async () => {
  await renderViews();
  await act(async () => { scanButton(document.getElementById('overview')).click(); });
  assert.equal(scanCalls.length, 1);
  assert.equal(scanCalls[0].folderId, folder.id);
  assert.equal(scanCalls[0].options.detectDuplicates, true);
  assert.equal(typeof scanCalls[0].options.requestId, 'string');
});
