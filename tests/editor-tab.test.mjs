import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import React, { act, createElement as h } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let dom, server, createRoot, MemoryRouter, Routes, Route, useNavigate;
let EditorTab, I18nProvider, ThemeProvider, useTabsStore, useAppStore;
let root, navigate, disk, reads, writes, gitRequests, cancellations;
const folder = { id: 1, name: 'Test', rootPath: '/test', createdAt: 0, isAvailable: true };
const editorStub = '\0test-editor';

before(async () => {
  dom = new JSDOM('<html><body></body></html>', { url: 'https://editor.test', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) {
    globalThis[key] = key === 'window' ? dom.window : dom.window[key];
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  ({ createRoot } = await import('react-dom/client'));
  ({ MemoryRouter, Routes, Route, useNavigate } = await import('react-router-dom'));
  server = await createServer({
    configFile: false, appType: 'custom',
    esbuild: { jsx: 'automatic' },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { noExternal: ['@monaco-editor/react'] },
    plugins: [{
      name: 'test-editor', enforce: 'pre',
      resolveId(id) { if (id === '@monaco-editor/react') return editorStub; },
      load(id) { if (id === editorStub) return `
        import React from 'react';
        export default function Editor({ value, onChange, options, path }) {
          return React.createElement('textarea', {
            'aria-label': 'Test editor', 'data-path': path,
            'data-minimap': String(options.minimap.enabled), 'data-wrap': options.wordWrap,
            value, readOnly: options.readOnly, onChange: event => onChange(event.target.value),
          });
        }
      `; },
    }],
  });
  ({ default: EditorTab } = await server.ssrLoadModule('/src/renderer/views/EditorTab.tsx'));
  ({ I18nProvider } = await server.ssrLoadModule('/src/renderer/i18n.tsx'));
  ({ ThemeProvider } = await server.ssrLoadModule('/src/renderer/theme.tsx'));
  ({ useTabsStore } = await server.ssrLoadModule('/src/renderer/store/tabs-store.ts'));
  ({ useAppStore } = await server.ssrLoadModule('/src/renderer/store/app-store.ts'));
});

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('code-line-analysis-language', 'en');
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  disk = { content: 'original content', hash: 'original-hash', size: 100 };
  reads = []; writes = []; gitRequests = []; cancellations = [];
  window.api = {
    stats: { fileTags: async () => [] },
    file: {
      read: async (id, path) => {
        reads.push({ id, path });
        return { content: disk.content, meta: fileMeta(path) };
      },
      write: async (...args) => {
        writes.push(args);
        if (args[3] !== disk.hash) throw new Error('File changed on disk; reload before saving');
        disk = { content: args[2], hash: 'saved-hash', size: args[2].length };
        return fileMeta(args[1]);
      },
    },
    git: {
      fileInfo: (id, path, requestId) => new Promise(resolve => { gitRequests.push({ id, path, requestId, resolve }); }),
      cancelFileInfo: async requestId => { cancellations.push(requestId); },
    },
  };
  useTabsStore.setState({ fileTabsByFolder: {}, recentByFolder: {}, pendingClose: null });
  useTabsStore.getState().openFile(1, 'a.ts');
  useAppStore.setState({ folders: [folder], activeFolderId: 1, settingsOpen: false, revision: 0 });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  for (const request of gitRequests) request.resolve(null);
});
after(async () => { await server.close(); dom.window.close(); delete globalThis.window; });

function fileMeta(path = 'a.ts') {
  return { relPath: path, lang: /\.md$/i.test(path) ? 'Markdown' : 'TypeScript', size: disk.size, mtime: 0, hash: disk.hash, total: 1, code: 1, comment: 0, blank: 0, blockComment: 0 };
}
function Harness() {
  navigate = useNavigate();
  return h(Routes, null,
    h(Route, { path: '/editor/:relPath', element: h(EditorTab, { folder }) }),
    h(Route, { path: '/overview', element: h('div', null, 'Overview') }),
  );
}
async function mount(initialPath = '/editor/a.ts') {
  await act(async () => { root.render(h(MemoryRouter, {
    initialEntries: [initialPath], future: { v7_startTransition: true, v7_relativeSplatPath: true },
  }, h(I18nProvider, null, h(ThemeProvider, null, h(Harness))))); });
}
async function go(path) { await act(async () => { navigate(path); }); }
function editor() { return document.querySelector('textarea'); }
async function enableEdit() { await act(async () => { document.querySelector('[role="switch"]').click(); }); }
async function type(content) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(editor(), content);
    editor().dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
async function save() {
  await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })); });
}

function modeButton(label) {
  return [...document.querySelectorAll('[role="tablist"][aria-label="Markdown display"] [role="tab"]')]
    .find(node => node.textContent.trim() === label);
}
async function selectMode(label) {
  const button = modeButton(label);
  assert.ok(button, `missing Markdown mode: ${label}`);
  await act(async () => { button.click(); });
  assert.equal(modeButton(label).getAttribute('aria-selected'), 'true');
}
function markdownSource() { return document.querySelector('[data-markdown-source]'); }
function markdownPreview() { return document.querySelector('[role="region"][aria-label="Markdown preview"]'); }
function isVisible(node) { return Boolean(node && !node.closest('[hidden]')); }
function markdownTab() { return useTabsStore.getState().fileTabsByFolder[1].find(tab => tab.relPath === 'README.md'); }
function prepareMarkdown() {
  disk.content = '# Original title\n\nOriginal text.';
  useTabsStore.getState().openFile(1, 'README.md');
}

test('returning to an edited document keeps edit mode and detects external disk changes', async () => {
  await mount();
  await enableEdit();
  await type('my draft');
  assert.equal(useTabsStore.getState().fileTabsByFolder[1][0].originalHash, 'original-hash');
  await go('/overview');
  disk = { content: 'external changes', hash: 'external-hash', size: 100 };
  await go('/editor/a.ts');
  assert.equal(editor().readOnly, false);
  assert.equal(editor().value, 'my draft');
  await save();
  assert.equal(writes[0][3], 'original-hash');
  assert.equal(disk.content, 'external changes');
  assert.equal(editor().value, 'my draft');
  assert.equal(useAppStore.getState().revision, 0);
});

test('successful saves refresh results and clear the stored draft', async () => {
  await mount();
  await enableEdit();
  await type('saved content');
  await save();
  assert.equal(writes[0][3], 'original-hash');
  assert.equal(disk.content, 'saved content');
  assert.equal(useTabsStore.getState().fileTabsByFolder[1][0].draft, undefined);
  assert.equal(useAppStore.getState().revision, 1);
});

test('navigation cancels the pending blame and ignores its eventual stale result', async () => {
  await mount();
  const first = gitRequests[0];
  assert.ok(first.requestId);
  await go('/overview');
  assert.deepEqual(cancellations, [first.requestId]);
  await go('/editor/a.ts');
  assert.notEqual(gitRequests[1].requestId, first.requestId);
  await act(async () => { first.resolve({ lastAuthor: 'Stale author', lastSha: 'abc', lastDate: 0, topAuthors: [] }); });
  assert.equal(document.body.textContent.includes('Stale author'), false);
});

test('large accepted documents disable minimap and wrapping', async () => {
  disk.size = 1024 * 1024;
  await mount();
  assert.equal(editor().dataset.minimap, 'false');
  assert.equal(editor().dataset.wrap, 'off');
  assert.equal(editor().dataset.path, '1:a.ts');
});

test('Markdown documents switch between a single source, a single preview, and side by side', async () => {
  prepareMarkdown();
  await mount('/editor/README.md');
  assert.equal(modeButton('Preview').getAttribute('aria-selected'), 'true');
  assert.equal(isVisible(markdownSource()), false);
  assert.equal(markdownPreview().querySelector('h1').textContent, 'Original title');

  await selectMode('Source');
  assert.equal(isVisible(markdownSource()), true);
  assert.equal(isVisible(markdownPreview()), false);

  await selectMode('Preview');
  assert.equal(isVisible(markdownSource()), false);
  assert.equal(markdownPreview().querySelector('h1').textContent, 'Original title');
  assert.equal(isVisible(markdownPreview()), true);

  await selectMode('Side by side');
  assert.equal(isVisible(markdownSource()), true);
  assert.equal(isVisible(markdownPreview()), true);

  await selectMode('Source');
  assert.equal(isVisible(markdownSource()), true);
  assert.equal(isVisible(markdownPreview()), false);
  assert.equal(reads.length, 1, 'changing the presentation must not reload file contents');
  assert.equal(editor().value, disk.content);
});

test('Markdown preview reflects unsaved edits and mode changes preserve the draft', async () => {
  prepareMarkdown();
  await mount('/editor/README.md');
  await enableEdit();
  assert.equal(modeButton('Side by side').getAttribute('aria-selected'), 'true');
  assert.equal(isVisible(markdownSource()), true, 'enabling edit mode reveals an editable source');
  await type('# Draft title\n\n**Unsaved text**');
  assert.equal(markdownPreview().querySelector('h1').textContent, 'Draft title');
  assert.equal(markdownPreview().querySelector('strong').textContent, 'Unsaved text');
  assert.equal(markdownTab().draft, '# Draft title\n\n**Unsaved text**');
  assert.deepEqual(writes, []);

  await selectMode('Preview');
  assert.equal(isVisible(markdownSource()), false);
  assert.equal(markdownPreview().querySelector('h1').textContent, 'Draft title');
  await selectMode('Source');
  assert.equal(editor().value, '# Draft title\n\n**Unsaved text**');
  assert.equal(editor().readOnly, false);
  assert.equal(markdownTab().originalHash, 'original-hash');
  assert.equal(disk.content, '# Original title\n\nOriginal text.');
});

test('each Markdown tab keeps its display mode and edited content while other files remain source-only', async () => {
  prepareMarkdown();
  await mount('/editor/README.md');
  await enableEdit();
  await type('# Saved in the tab');
  await selectMode('Preview');
  await go('/editor/a.ts');
  assert.equal(document.querySelector('[aria-label="Markdown display"]'), null);
  assert.equal(markdownPreview(), null);
  assert.equal(editor().dataset.path, '1:a.ts');

  await act(async () => { useTabsStore.getState().openFile(1, 'notes.md'); });
  await go('/editor/notes.md');
  assert.equal(modeButton('Preview').getAttribute('aria-selected'), 'true');
  await selectMode('Side by side');

  disk = { content: '# Changed on disk', hash: 'external-hash', size: 100 };
  await go('/editor/README.md');
  assert.equal(modeButton('Preview').getAttribute('aria-selected'), 'true');
  assert.equal(isVisible(markdownSource()), false);
  assert.equal(markdownPreview().querySelector('h1').textContent, 'Saved in the tab');
  assert.equal(markdownTab().draft, '# Saved in the tab');
  assert.equal(markdownTab().originalHash, 'original-hash');
  const persisted = JSON.parse(window.localStorage.getItem('code-line-analysis-file-tabs'))[1]
    .find(tab => tab.relPath === 'README.md');
  assert.equal(persisted.markdownMode, 'preview');
  assert.equal(persisted.draft, undefined);

  await go('/editor/notes.md');
  assert.equal(modeButton('Side by side').getAttribute('aria-selected'), 'true');
  assert.equal(isVisible(markdownSource()), true);
  assert.equal(isVisible(markdownPreview()), true);
});

test('Markdown line deep links reveal the source and retain a side by side view', async () => {
  prepareMarkdown();
  await mount('/editor/README.md');
  await selectMode('Preview');
  await go('/editor/README.md?line=2&endLine=3&highlight=function');
  assert.equal(modeButton('Source').getAttribute('aria-selected'), 'true');
  assert.equal(isVisible(markdownSource()), true);
  assert.equal(editor().value, disk.content);
  await selectMode('Side by side');
  await go('/editor/README.md?line=3');
  assert.equal(modeButton('Side by side').getAttribute('aria-selected'), 'true');
  assert.equal(isVisible(markdownSource()), true);
  assert.equal(isVisible(markdownPreview()), true);
});
