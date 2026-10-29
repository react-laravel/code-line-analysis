import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import React, { act, createElement as h } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let dom, server, createRoot, MemoryRouter, useLocation;
let MarkdownPreview, I18nProvider, useTabsStore;
let root, externalLinks, imageReads;
const previewImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBcoAAAAASUVORK5CYII=';

before(async () => {
  dom = new JSDOM('<html><body></body></html>', { url: 'https://markdown.test', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent']) {
    globalThis[key] = key === 'window' ? dom.window : dom.window[key];
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import('react-dom/client'));
  ({ MemoryRouter, useLocation } = await import('react-router-dom'));
  server = await createServer({
    configFile: false, appType: 'custom', esbuild: { jsx: 'automatic' },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ default: MarkdownPreview } = await server.ssrLoadModule('/src/renderer/views/editor/MarkdownPreview.tsx'));
  ({ I18nProvider } = await server.ssrLoadModule('/src/renderer/i18n.tsx'));
  ({ useTabsStore } = await server.ssrLoadModule('/src/renderer/store/tabs-store.ts'));
});

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('code-line-analysis-language', 'en');
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  externalLinks = [];
  imageReads = [];
  window.api = {
    system: { openExternal: async url => { externalLinks.push(url); } },
    file: { readImage: async (folderId, relPath) => {
      imageReads.push({ folderId, relPath });
      return previewImage;
    } },
  };
  useTabsStore.setState({ fileTabsByFolder: {}, recentByFolder: {}, pendingClose: null });
});

afterEach(async () => { await act(async () => { root.unmount(); }); });
after(async () => { await server.close(); dom.window.close(); delete globalThis.window; });

function Location() {
  const { pathname, search } = useLocation();
  return h('output', { 'aria-label': 'Current route' }, pathname + search);
}

async function render(content, relPath = 'docs/guide.md') {
  await act(async () => {
    root.render(h(MemoryRouter, {
      initialEntries: ['/editor/docs%2Fguide.md'],
      future: { v7_startTransition: true, v7_relativeSplatPath: true },
    }, h(I18nProvider, null,
      h(MarkdownPreview, { content, folderId: 1, relPath }),
      h(Location),
    )));
  });
}

function preview() { return document.querySelector('[role="region"][aria-label="Markdown preview"]'); }
async function clickLink(label) {
  const link = [...preview().querySelectorAll('a')].find(node => node.textContent === label);
  assert.ok(link, `missing link: ${label}`);
  await act(async () => { link.click(); });
}

test('Markdown renders headings, GFM tables and task lists, and literal fenced code', async () => {
  await render([
    '# Document title', '',
    '**Strong text** and ~~removed text~~.', '',
    '| Language | Files |', '| --- | ---: |', '| TypeScript | 2 |', '',
    '- [x] Finished', '- [ ] Pending', '',
    '```ts', 'const html = "<script>alert(1)</script>";', '```',
  ].join('\n'));

  assert.equal(preview().querySelector('h1').textContent, 'Document title');
  assert.equal(preview().querySelector('strong').textContent, 'Strong text');
  assert.equal(preview().querySelector('del').textContent, 'removed text');
  assert.deepEqual([...preview().querySelectorAll('thead th')].map(node => node.textContent), ['Language', 'Files']);
  assert.deepEqual([...preview().querySelectorAll('tbody td')].map(node => node.textContent), ['TypeScript', '2']);
  const checkboxes = [...preview().querySelectorAll('input[type="checkbox"]')];
  assert.deepEqual(checkboxes.map(node => ({ checked: node.checked, disabled: node.disabled })), [
    { checked: true, disabled: true }, { checked: false, disabled: true },
  ]);
  assert.equal(preview().querySelector('pre code.language-ts').textContent, 'const html = "<script>alert(1)</script>";\n');
  assert.equal(preview().querySelector('script'), null);
});

test('repository Markdown cannot render executable HTML or open script URLs', async () => {
  await render([
    '# Safe title', '',
    '<script>window.markdownExecuted = true</script>', '',
    '<iframe src="https://evil.test"></iframe>', '',
    '<img src="x" onerror="window.markdownExecuted = true">', '',
    '[unsafe](javascript:alert%281%29)', '',
    '[data](data:text/html;base64,PHNjcmlwdD4=)',
  ].join('\n'));

  assert.equal(preview().querySelector('script, iframe, img, [onerror], [onclick]'), null);
  assert.equal(window.markdownExecuted, undefined);
  for (const link of preview().querySelectorAll('a')) {
    assert.doesNotMatch(link.getAttribute('href') ?? '', /^(javascript|data):/i);
    await act(async () => { link.click(); });
  }
  assert.deepEqual(externalLinks, []);
  assert.deepEqual(useTabsStore.getState().fileTabsByFolder, {});
});

test('relative Markdown links open repository documents and external links use the desktop bridge', async () => {
  await render('[Sibling](./next.md) and [Parent](../README.md) and [Website](https://example.com/docs).');
  await clickLink('Sibling');
  assert.equal(useTabsStore.getState().fileTabsByFolder[1][0].relPath, 'docs/next.md');
  assert.equal(document.querySelector('[aria-label="Current route"]').textContent, '/editor/docs%2Fnext.md');
  await clickLink('Parent');
  assert.equal(useTabsStore.getState().fileTabsByFolder[1][1].relPath, 'README.md');
  await clickLink('Website');
  assert.deepEqual(externalLinks, ['https://example.com/docs']);
  assert.equal(useTabsStore.getState().fileTabsByFolder[1].length, 2);
});

test('preview heading anchors are unique and links outside the repository stay inert', async () => {
  await render('# Setup\n\n# Setup\n\n[Outside](../../outside.md)');
  const ids = [...preview().querySelectorAll('h1')].map(node => node.id);
  assert.ok(ids.every(Boolean));
  assert.equal(new Set(ids).size, ids.length);
  assert.match(preview().textContent, /Outside/);
  assert.equal([...preview().querySelectorAll('a')].find(node => node.textContent === 'Outside'), undefined);
  assert.deepEqual(useTabsStore.getState().fileTabsByFolder, {});
  assert.deepEqual(externalLinks, []);
});

test('local Markdown images use the repository image reader while remote images are not fetched', async () => {
  await render('![Local diagram](./images/diagram.png)\n\n![Remote diagram](https://example.com/diagram.png)');
  assert.deepEqual(imageReads, [{ folderId: 1, relPath: 'docs/images/diagram.png' }]);
  const local = preview().querySelector('img[alt="Local diagram"]');
  assert.ok(local);
  assert.equal(local.getAttribute('src'), previewImage);
  assert.equal(preview().querySelector('img[src="https://example.com/diagram.png"]'), null);
  assert.deepEqual(externalLinks, []);
});
