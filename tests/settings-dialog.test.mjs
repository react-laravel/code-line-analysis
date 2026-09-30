import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import React, { act, createElement as h } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let dom;
let server;
let createRoot;
let MemoryRouter;
let useLocation;
let useNavigate;
let SideNav;
let navigateSidebar;
let I18nProvider;
let useI18n;
let setTestLanguage;
let ThemeProvider;
let SettingsDialog;
let useRuleEditorPanel;
let useAppStore;
let useScanStore;
let useShortcuts;
let root;
let host;
let trigger;
let panel;
let calls;
let savedGlobal;
let hookProps;
let mediaWide = true;

const folderA = { id: 1, name: 'Project A', rootPath: '/projects/a', createdAt: 0, isAvailable: true };
const folderB = { id: 2, name: 'Project B', rootPath: '/projects/b', createdAt: 0, isAvailable: true };
const rules = (allow = [], block = []) => ({ whitelist: allow, blacklist: block });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://settings.test/', pretendToBeVisual: true,
  });
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) {
    globalThis[key] = key === 'window' ? dom.window : dom.window[key];
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = query => ({
    matches: mediaWide, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent() { return true; },
  });
  // jsdom has no layout. Represent connected, visible controls as laid out so
  // the production focus trap can use its normal offsetParent visibility test.
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return this.isConnected && !this.closest('[hidden]') ? this.parentElement : null; },
  });
  ({ createRoot } = await import('react-dom/client'));
  ({ MemoryRouter, useLocation, useNavigate } = await import('react-router-dom'));
  server = await createServer({
    configFile: false, appType: 'custom',
    define: { __APP_VERSION__: JSON.stringify('test-version') },
    esbuild: { jsx: 'automatic' },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ I18nProvider, useI18n } = await server.ssrLoadModule('/src/renderer/i18n.tsx'));
  ({ ThemeProvider } = await server.ssrLoadModule('/src/renderer/theme.tsx'));
  ({ useAppStore } = await server.ssrLoadModule('/src/renderer/store/app-store.ts'));
  ({ useScanStore } = await server.ssrLoadModule('/src/renderer/store/scan-store.ts'));
  ({ useRuleEditorPanel } = await server.ssrLoadModule('/src/renderer/components/RuleEditorPanel.tsx'));
  ({ useShortcuts } = await server.ssrLoadModule('/src/renderer/hooks/useShortcuts.ts'));
  ({ default: SideNav } = await server.ssrLoadModule('/src/renderer/shell/SideNav.tsx'));
  ({ default: SettingsDialog } = await server.ssrLoadModule('/src/renderer/views/SettingsDialog.tsx'));
});

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('code-line-analysis-language', 'en');
  document.body.innerHTML = '<button id="open-settings">Open settings</button><div id="test-root"></div>';
  trigger = document.getElementById('open-settings');
  host = document.getElementById('test-root');
  root = createRoot(host);
  panel = undefined;
  hookProps = undefined;
  mediaWide = true;
  calls = { globalGet: 0, globalSet: [], folderGet: [], folderSet: [], duplicateSet: [], minimumSet: [], scans: [], picks: 0 };
  savedGlobal = rules(['src/**'], ['node_modules']);
  window.api = {
    runtime: { mode: 'mock' },
    settings: {
      getGlobalRules: async () => { calls.globalGet += 1; return savedGlobal; },
      setGlobalRules: async payload => { calls.globalSet.push(payload); savedGlobal = payload; return payload; },
    },
    folders: {
      pickDirectory: async () => { calls.picks += 1; return null; },
      getRules: async id => { calls.folderGet.push(id); return rules([`folder-${id}/**`]); },
      setRules: async (id, payload) => { calls.folderSet.push([id, payload]); return payload; },
      getDuplicateRules: async () => rules(['duplicates/**']),
      setDuplicateRules: async (id, payload) => { calls.duplicateSet.push([id, payload]); return payload; },
      getDuplicateMinLines: async () => 8,
      setDuplicateMinLines: async (id, count) => { calls.minimumSet.push([id, count]); },
    },
    scan: {
      run: async (id, options) => { calls.scans.push([id, options]); return { totalFiles: 10 }; },
      cancel: async () => {},
    },
  };
  useAppStore.setState({
    folders: [folderA, folderB], activeFolderId: folderA.id,
    settingsOpen: false, settingsTab: 'general', settingsScope: 'global',
    autoScanOnOpen: false, restoreLastFolder: false, detectDuplicatesOnScan: false,
    paletteOpen: false, shortcutHelpOpen: false, sidebarCollapsed: false, revision: 0,
  });
  useScanStore.getState().reset();
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  useScanStore.getState().reset();
  document.body.replaceChildren();
});

after(async () => {
  await server?.close();
  dom?.window.close();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'IS_REACT_ACT_ENVIRONMENT']) {
    delete globalThis[key];
  }
});

function HookHarness(props) {
  setTestLanguage = useI18n().setLanguage;
  panel = useRuleEditorPanel(props);
  return panel.node;
}

async function renderHook(next = {}) {
  hookProps = { scope: 'global', folder: folderA, active: true, ...hookProps, ...next };
  await act(async () => { root.render(h(I18nProvider, null, h(HookHarness, hookProps))); });
}

function DialogHarness() {
  useShortcuts();
  return h(SettingsDialog);
}

async function mountDialog(tab = 'general', scope = 'global') {
  trigger.focus();
  useAppStore.setState({ settingsOpen: true, settingsTab: tab, settingsScope: scope });
  await act(async () => {
    root.render(h(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } },
      h(I18nProvider, null, h(ThemeProvider, null, h(DialogHarness)))));
  });
}

function button(name) {
  const match = [...document.querySelectorAll('button')].find(node =>
    (node.getAttribute('aria-label') ?? node.textContent).replace(/\s+/g, ' ').trim() === name);
  assert.ok(match, `Button ${JSON.stringify(name)} exists`);
  return match;
}

function saveButton() {
  const match = [...document.querySelectorAll('button')].find(node =>
    node.textContent.trim().startsWith('Save') && !node.textContent.includes('Rescan'));
  assert.ok(match, 'Save button exists');
  return match;
}

function textareas() { return [...document.querySelectorAll('textarea')]; }

async function changeValue(element, value) {
  assert.ok(element, 'Input exists');
  await act(async () => {
    const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
      : element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
    element.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

async function click(element) { await act(async () => { element.click(); }); }
async function key(target, keyName, extra = {}) {
  let event;
  await act(async () => {
    event = new window.KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(event);
  });
  return event;
}
async function settle(job, value) { await act(async () => { job.resolve(value); await job.promise; }); }
async function fail(job, error = new Error('Unavailable')) {
  await act(async () => { job.reject(error); await job.promise.catch(() => {}); });
}

// Hook lifecycle tests use the same rendered editor and actual input events as
// the dialog, while permitting context changes that a pending dialog blocks.
test('inactive rules do not load; delayed loading prevents edits and writes', async () => {
  hookProps = undefined;
  const load = deferred();
  window.api.settings.getGlobalRules = () => { calls.globalGet += 1; return load.promise; };
  await renderHook({ active: false });
  assert.equal(calls.globalGet, 0);
  await renderHook({ active: true });
  assert.equal(calls.globalGet, 1);
  assert.equal(panel.editable, false);
  assert.ok(textareas().every(node => node.matches(':disabled') || node.readOnly));
  let written;
  await act(async () => { written = await panel.save(); });
  assert.equal(written, false);
  assert.equal(calls.globalSet.length, 0);
  await settle(load, rules(['loaded/**']));
  assert.equal(panel.editable, true);
  assert.equal(textareas()[0].value, 'loaded/**');
});

test('a failed load blocks writes until Retry successfully loads the context', async () => {
  hookProps = undefined;
  window.api.settings.getGlobalRules = async () => { throw new Error('Offline'); };
  await renderHook();
  assert.equal(panel.editable, false);
  assert.match(document.body.textContent, /Could not load/);
  let written;
  await act(async () => { written = await panel.save(); });
  assert.equal(written, false);
  assert.equal(calls.globalSet.length, 0);
  window.api.settings.getGlobalRules = async () => rules(['recovered/**']);
  await click(button('Try again'));
  assert.equal(panel.editable, true);
  assert.equal(textareas()[0].value, 'recovered/**');
});

test('switching scope immediately blocks saving old text and ignores stale loads', async () => {
  hookProps = undefined;
  const oldLoad = deferred();
  const nextLoad = deferred();
  window.api.settings.getGlobalRules = () => oldLoad.promise;
  window.api.folders.getRules = () => nextLoad.promise;
  await renderHook();
  await renderHook({ scope: 'folder' });
  assert.equal(panel.editable, false);
  await act(async () => { assert.equal(await panel.save(), false); });
  assert.equal(calls.folderSet.length, 0);
  await settle(nextLoad, rules(['correct-folder/**']));
  await settle(oldLoad, rules(['stale-global/**']));
  assert.equal(textareas()[0].value, 'correct-folder/**');
});

test('closing and reopening ignores the previous session load', async () => {
  hookProps = undefined;
  const first = deferred();
  const second = deferred();
  let count = 0;
  window.api.settings.getGlobalRules = () => ++count === 1 ? first.promise : second.promise;
  await renderHook();
  await renderHook({ active: false });
  await renderHook({ active: true });
  await settle(second, rules(['new-session/**']));
  await settle(first, rules(['old-session/**']));
  assert.equal(textareas()[0].value, 'new-session/**');
});

test('saving normalizes rules and persists them after the editor reopens', async () => {
  hookProps = undefined;
  await renderHook();
  await changeValue(textareas()[0], ' src/** \n\n lib/**\nsrc/**');
  await changeValue(textareas()[1], ' vendor \n vendor\n **/generated/** ');
  await act(async () => { assert.equal(await panel.save(), true); });
  assert.deepEqual(calls.globalSet, [rules(['src/**', 'lib/**'], ['vendor', '**/generated/**'])]);
  assert.equal(textareas()[0].value, 'src/**\nlib/**');
  assert.match(document.body.textContent, /Saved/);
  await renderHook({ active: false });
  await renderHook({ active: true });
  assert.equal(textareas()[1].value, 'vendor\n**/generated/**');
});

test('same-tick repeated saves write only once and lock editing while pending', async () => {
  hookProps = undefined;
  const save = deferred();
  window.api.settings.setGlobalRules = payload => { calls.globalSet.push(payload); return save.promise; };
  await renderHook();
  let first;
  let second;
  await act(async () => { first = panel.save(); second = panel.save(); });
  assert.equal(calls.globalSet.length, 1);
  assert.equal(panel.saving, true);
  assert.ok(textareas().every(node => node.matches(':disabled') || node.readOnly));
  await settle(save, rules(['src/**'], ['node_modules']));
  assert.deepEqual(await Promise.all([first, second]), [true, false]);
  assert.equal(panel.saving, false);
});

test('a save completing in a new scope does not replace its text or report success', async () => {
  hookProps = undefined;
  const save = deferred();
  window.api.settings.setGlobalRules = () => save.promise;
  await renderHook();
  let pending;
  await act(async () => { pending = panel.save(); });
  await renderHook({ scope: 'folder', folder: folderB });
  await settle(save, rules(['old-save/**']));
  assert.equal(await pending, false);
  assert.equal(textareas()[0].value, 'folder-2/**');
  assert.doesNotMatch(document.body.textContent, /Saved/);
});

test('a save completing after close and reopen cannot overwrite the new session', async () => {
  hookProps = undefined;
  const save = deferred();
  window.api.settings.setGlobalRules = () => save.promise;
  await renderHook();
  let pending;
  await act(async () => { pending = panel.save(); });
  await renderHook({ active: false });
  window.api.settings.getGlobalRules = async () => rules(['reopened/**']);
  await renderHook({ active: true });
  await settle(save, rules(['stale-save/**']));
  assert.equal(await pending, false);
  assert.equal(textareas()[0].value, 'reopened/**');
});

test('a failed save retains the draft and permits an explicit successful retry', async () => {
  hookProps = undefined;
  await renderHook();
  await changeValue(textareas()[0], 'keep-this-draft/**');
  window.api.settings.setGlobalRules = async () => { throw new Error('Write failed'); };
  await act(async () => { assert.equal(await panel.save(), false); });
  assert.equal(panel.saving, false);
  assert.equal(textareas()[0].value, 'keep-this-draft/**');
  assert.match(document.body.textContent, /Unable to save/);
  window.api.settings.setGlobalRules = async payload => { calls.globalSet.push(payload); return payload; };
  await act(async () => { assert.equal(await panel.save(), true); });
  assert.deepEqual(calls.globalSet, [rules(['keep-this-draft/**'], ['node_modules'])]);
  assert.doesNotMatch(document.body.textContent, /Unable to save/);
});

test('duplicate minimum lines rejects invalid values without writes and accepts the floor', async () => {
  hookProps = undefined;
  await renderHook({ scope: 'duplicates' });
  const minimum = document.querySelector('input[type="number"]');
  for (const value of ['', '2', '3.5']) {
    await changeValue(minimum, value);
    await act(async () => { assert.equal(await panel.save(), false); });
    assert.match(document.body.textContent, /integer of 3 or greater/);
    assert.equal(minimum.getAttribute('aria-invalid'), 'true');
    assert.match(document.getElementById(minimum.getAttribute('aria-describedby')).textContent, /integer of 3 or greater/);
    assert.match(document.querySelector('[role="alert"]').textContent, /integer of 3 or greater/);
    assert.equal(calls.minimumSet.length, 0);
    assert.equal(calls.duplicateSet.length, 0);
  }
  await changeValue(minimum, '3');
  await act(async () => { assert.equal(await panel.save(), true); });
  assert.deepEqual(calls.minimumSet, [[folderA.id, 3]]);
  assert.deepEqual(calls.duplicateSet, [[folderA.id, rules(['duplicates/**'])]]);
});

test('missing duplicate APIs never enable saving', async () => {
  hookProps = undefined;
  delete window.api.folders.getDuplicateRules;
  delete window.api.folders.setDuplicateRules;
  await renderHook({ scope: 'duplicates' });
  assert.equal(panel.editable, false);
  await act(async () => { assert.equal(await panel.save(), false); });
  assert.equal(calls.minimumSet.length, 0);
  assert.ok(textareas().every(node => node.matches(':disabled') || node.readOnly));
});

test('sidebar tabs expose linked panels and support vertical keyboard navigation', async () => {
  await mountDialog();
  const list = document.querySelector('[role="tablist"]');
  assert.equal(list.getAttribute('aria-orientation'), 'vertical');
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  assert.equal(tabs.length, 4);
  assert.equal(tabs.filter(node => node.tabIndex === 0).length, 1);
  tabs[0].focus();
  await key(tabs[0], 'ArrowDown');
  assert.ok(document.activeElement === tabs[1], 'Expected control has keyboard focus');
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  let content = document.getElementById(tabs[1].getAttribute('aria-controls'));
  assert.equal(content.getAttribute('role'), 'tabpanel');
  assert.equal(content.getAttribute('aria-labelledby'), tabs[1].id);
  await key(tabs[1], 'End');
  assert.ok(document.activeElement === tabs[3], 'Expected control has keyboard focus');
  await key(tabs[3], 'Home');
  assert.ok(document.activeElement === tabs[0], 'Expected control has keyboard focus');
  await key(tabs[0], 'ArrowUp');
  assert.ok(document.activeElement === tabs[3], 'Expected control has keyboard focus');
});

test('the modal wraps focus and restores the opener after Escape and close', async () => {
  await mountDialog();
  const dialog = document.querySelector('[role="dialog"]');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.ok(document.getElementById(dialog.getAttribute('aria-labelledby')));
  assert.ok(dialog.contains(document.activeElement));
  const focusables = [...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(node => node.tabIndex !== -1);
  const first = focusables[0];
  const last = focusables.at(-1);
  last.focus();
  assert.equal((await key(last, 'Tab')).defaultPrevented, true);
  assert.ok(document.activeElement === first, 'Expected control has keyboard focus');
  assert.equal((await key(first, 'Tab', { shiftKey: true })).defaultPrevented, true);
  assert.ok(document.activeElement === last, 'Expected control has keyboard focus');
  await key(last, 'Escape');
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.ok(document.activeElement === trigger, 'Expected control has keyboard focus');
  await act(async () => { useAppStore.getState().setSettingsOpen(true); });
  await click(button('Close'));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.ok(document.activeElement === trigger, 'Expected control has keyboard focus');
});

test('pending dialog saves block repeat shortcuts, navigation, and dismissal', async () => {
  const save = deferred();
  window.api.settings.setGlobalRules = payload => { calls.globalSet.push(payload); return save.promise; };
  await mountDialog('rules');
  await key(textareas()[0], 's', { ctrlKey: true });
  assert.equal(calls.globalSet.length, 1);
  assert.equal(saveButton().disabled, true);
  assert.equal(button('Save & Rescan').disabled, true);
  await key(textareas()[0], 's', { ctrlKey: true, repeat: true });
  await key(document.activeElement, 'Escape');
  assert.equal(calls.globalSet.length, 1);
  assert.ok(document.querySelector('[role="dialog"]'));
  for (const tab of document.querySelectorAll('[role="tab"]')) assert.equal(tab.disabled, true);
  const close = [...document.querySelectorAll('button')].filter(node => (node.getAttribute('aria-label') ?? node.textContent).trim() === 'Close');
  for (const control of close) {
    assert.equal(control.disabled, true);
    await click(control);
  }
  await settle(save, rules(['src/**'], ['node_modules']));
  assert.equal(saveButton().disabled, false);
  await key(document.activeElement, 'Escape');
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test('Save & Rescan runs only after a successful save, once, for the active folder', async () => {
  const save = deferred();
  window.api.settings.setGlobalRules = payload => { calls.globalSet.push(payload); return save.promise; };
  await mountDialog('rules');
  await click(button('Save & Rescan'));
  assert.equal(calls.scans.length, 0);
  await click(button('Save & Rescan'));
  await settle(save, rules(['src/**'], ['node_modules']));
  assert.equal(calls.globalSet.length, 1);
  assert.deepEqual(calls.scans, [[folderA.id, { detectDuplicates: false }]]);
});

test('without a folder, folder-scoped entry falls back safely and rescan stays disabled', async () => {
  useAppStore.setState({ folders: [], activeFolderId: null });
  await mountDialog('rules', 'folder');
  assert.equal(useAppStore.getState().settingsScope, 'global');
  assert.equal(button('Save & Rescan').disabled, true);
  assert.equal(calls.folderGet.length, 0);
  assert.equal(calls.folderSet.length, 0);
});

test('theme cards use labelled native radios and persist a selected mode immediately', async () => {
  await mountDialog('appearance');
  const options = [...document.querySelectorAll('input[type="radio"]')];
  assert.equal(options.length, 2);
  const light = options.find(node => node.value === 'light');
  assert.ok(light);
  assert.ok(light.labels.length > 0 || light.getAttribute('aria-label'));
  await click(light);
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(window.localStorage.getItem('code-line-analysis-theme'), 'light');
  assert.equal(options.filter(node => node.checked).length, 1);
});


test('changing folders within the same scope ignores the old folder load', async () => {
  const first = deferred();
  const second = deferred();
  window.api.folders.getRules = id => id === folderA.id ? first.promise : second.promise;
  await renderHook({ scope: 'folder', folder: folderA });
  await renderHook({ folder: folderB });
  assert.equal(panel.editable, false);
  await settle(second, rules(['project-b/**']));
  await settle(first, rules(['project-a/**']));
  assert.equal(textareas()[0].value, 'project-b/**');
  await act(async () => { assert.equal(await panel.save(), true); });
  assert.deepEqual(calls.folderSet, [[folderB.id, rules(['project-b/**'])]]);
});

test('failed Save & Rescan keeps the draft and never starts scanning', async () => {
  const save = deferred();
  window.api.settings.setGlobalRules = () => save.promise;
  await mountDialog('rules');
  await changeValue(textareas()[0], 'unsaved/**');
  await click(button('Save & Rescan'));
  await fail(save);
  assert.equal(calls.scans.length, 0);
  assert.equal(textareas()[0].value, 'unsaved/**');
  assert.match(document.body.textContent, /Unable to save/);
  assert.equal(button('Save & Rescan').disabled, false);
});

test('Save & Rescan never scans a newly selected folder after an earlier save', async () => {
  const save = deferred();
  window.api.folders.setRules = (id, payload) => { calls.folderSet.push([id, payload]); return save.promise; };
  await mountDialog('rules', 'folder');
  await click(button('Save & Rescan'));
  await act(async () => { useAppStore.getState().setActiveFolderId(folderB.id); });
  await settle(save, rules(['project-a/**']));
  assert.equal(calls.folderSet[0][0], folderA.id);
  assert.equal(calls.scans.length, 0);
  assert.equal(textareas()[0].value, 'folder-2/**');
});

test('unavailable folders can edit rules but cannot start a rescan', async () => {
  useAppStore.setState({ folders: [{ ...folderA, isAvailable: false }], activeFolderId: folderA.id });
  await mountDialog('rules', 'folder');
  assert.equal(saveButton().disabled, false);
  assert.equal(button('Save & Rescan').disabled, true);
  await click(button('Save & Rescan'));
  assert.equal(calls.scans.length, 0);
});

test('narrow settings navigation exposes horizontal semantics and arrow keys', async () => {
  mediaWide = false;
  await mountDialog();
  const list = document.querySelector('[role="tablist"]');
  assert.equal(list.getAttribute('aria-orientation'), 'horizontal');
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  tabs[0].focus();
  await key(tabs[0], 'ArrowRight');
  assert.ok(document.activeElement === tabs[1], 'Expected control has keyboard focus');
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  await key(tabs[1], 'ArrowLeft');
  assert.ok(document.activeElement === tabs[0], 'Expected control has keyboard focus');
});

test('general preferences apply immediately and language updates visible labels', async () => {
  await mountDialog();
  const toggles = [...document.querySelectorAll('[role="switch"]')];
  assert.equal(toggles.length, 3);
  for (const toggle of toggles) {
    assert.ok(toggle.getAttribute('aria-label'));
    await click(toggle);
    assert.equal(toggle.getAttribute('aria-checked'), 'true');
  }
  assert.equal(useAppStore.getState().restoreLastFolder, true);
  assert.equal(useAppStore.getState().autoScanOnOpen, true);
  assert.equal(useAppStore.getState().detectDuplicatesOnScan, true);
  for (const setting of ['restore-last-folder', 'auto-scan-on-open', 'detect-duplicates-on-scan']) {
    assert.equal(window.localStorage.getItem(`code-line-analysis-${setting}`), 'true');
  }
  await changeValue(document.querySelector('select'), 'zh-CN');
  assert.equal(window.localStorage.getItem('code-line-analysis-language'), 'zh-CN');
  assert.match(document.querySelector('[role="tab"][aria-selected="true"]').textContent, /通用/);
});


test('missing minimum-line methods disable the duplicate editor without any writes', async () => {
  for (const method of ['getDuplicateMinLines', 'setDuplicateMinLines']) {
    const original = window.api.folders[method];
    delete window.api.folders[method];
    await renderHook({ scope: 'duplicates' });
    assert.equal(panel.editable, false, method);
    await act(async () => { assert.equal(await panel.save(), false); });
    assert.equal(calls.minimumSet.length, 0);
    assert.equal(calls.duplicateSet.length, 0);
    window.api.folders[method] = original;
    await renderHook({ active: false });
    await renderHook({ active: true });
    assert.equal(panel.editable, true);
  }
});

test('partial duplicate writes report the persisted threshold and retain patterns for retry', async () => {
  await renderHook({ scope: 'duplicates' });
  await changeValue(textareas()[0], 'keep-duplicate-draft/**');
  await changeValue(document.querySelector('input[type="number"]'), '12');
  window.api.folders.setDuplicateRules = async () => { throw new Error('Pattern write failed'); };
  await act(async () => { assert.equal(await panel.save(), false); });
  assert.deepEqual(calls.minimumSet, [[folderA.id, 12]]);
  assert.equal(textareas()[0].value, 'keep-duplicate-draft/**');
  assert.equal(panel.dirty, true);
  assert.match(document.body.textContent, /minimum line count was saved, but the patterns could not be saved/);
  assert.equal(document.querySelector('[role="alert"]')?.textContent.includes('minimum line count was saved'), true);
  window.api.folders.setDuplicateRules = async (id, payload) => { calls.duplicateSet.push([id, payload]); return payload; };
  await act(async () => { assert.equal(await panel.save(), true); });
  assert.deepEqual(calls.duplicateSet, [[folderA.id, rules(['keep-duplicate-draft/**'])]]);
  assert.equal(panel.dirty, false);
});

test('Settings prevents global shortcuts from acting on background content', async () => {
  const background = document.createElement('div');
  background.innerHTML = '<input data-view-search aria-label="Background search"><div data-explorer-tree><button role="treeitem" tabindex="0">Background file</button></div>';
  document.body.append(background);
  useAppStore.setState({ sidebarCollapsed: true });
  await mountDialog();
  const initial = document.activeElement;
  for (const chord of ['f', 'b', 'k', 'o', 'r']) {
    await key(initial, chord, { ctrlKey: true });
    await act(async () => { await new Promise(resolve => window.requestAnimationFrame(resolve)); });
    assert.ok(document.activeElement === initial, `Mod+${chord} retains modal focus`);
    assert.equal(useAppStore.getState().sidebarCollapsed, true, `Mod+${chord} leaves sidebar unchanged`);
    assert.equal(useAppStore.getState().paletteOpen, false, `Mod+${chord} does not open the palette`);
    assert.equal(calls.picks, 0, `Mod+${chord} does not open a folder picker`);
    assert.equal(calls.scans.length, 0, `Mod+${chord} does not rescan`);
  }
  await key(initial, '?');
  assert.equal(useAppStore.getState().shortcutHelpOpen, false);
});

test('scan preferences retain their established initial defaults', async () => {
  const initial = useAppStore.getInitialState();
  assert.equal(initial.restoreLastFolder, true);
  assert.equal(initial.autoScanOnOpen, false);
  assert.equal(initial.detectDuplicatesOnScan, true);
  useAppStore.setState({
    restoreLastFolder: initial.restoreLastFolder,
    autoScanOnOpen: initial.autoScanOnOpen,
    detectDuplicatesOnScan: initial.detectDuplicatesOnScan,
  });
  await mountDialog();
  assert.deepEqual([...document.querySelectorAll('[role="switch"]')].map(node => node.getAttribute('aria-checked')), ['true', 'false', 'true']);
});

test('closing or switching settings sections discards the draft without writing it', async () => {
  await mountDialog('rules');
  await changeValue(textareas()[0], 'discard-me/**');
  assert.match(document.body.textContent, /Closing or switching sections discards unsaved changes/);
  await click(document.querySelector('[data-settings-tab="general"]'));
  await click(document.querySelector('[data-settings-tab="rules"]'));
  assert.equal(textareas()[0].value, 'src/**');
  await changeValue(textareas()[0], 'discard-on-close/**');
  await click(button('Close'));
  await act(async () => { useAppStore.getState().setSettingsOpen(true); });
  assert.equal(textareas()[0].value, 'src/**');
  assert.equal(calls.globalSet.length, 0);
});


test('Tab recovers modal focus when the focused Save control becomes disabled', async () => {
  const save = deferred();
  window.api.settings.setGlobalRules = () => save.promise;
  await mountDialog('rules');
  const control = saveButton();
  control.focus();
  assert.ok(document.activeElement === control, 'Expected control has keyboard focus');
  await click(control);
  assert.equal(control.disabled, true);
  const content = document.querySelector('[role="tabpanel"]');
  const selectedTab = document.querySelector('[role="tab"][aria-selected="true"]');
  assert.equal(selectedTab.disabled, true);
  assert.equal(selectedTab.tabIndex, 0);
  assert.equal((await key(control, 'Tab')).defaultPrevented, true);
  assert.ok(document.activeElement === content, 'Focus moves to the enabled panel while controls are disabled');
  assert.equal((await key(content, 'Tab', { shiftKey: true })).defaultPrevented, true);
  assert.ok(document.activeElement === content, 'Focus moves to the enabled panel while controls are disabled');
  await settle(save, rules(['src/**'], ['node_modules']));
  assert.equal(control.disabled, false);
  await key(content, 'Escape');
  assert.ok(document.activeElement === trigger, 'Expected control has keyboard focus');
});

test('changing locale preserves a dirty rule draft and never reloads its persisted data', async () => {
  await renderHook();
  await changeValue(textareas()[0], 'keep-dirty-draft/**');
  await changeValue(textareas()[1], 'keep-dirty-block/**');
  assert.equal(panel.dirty, true);
  assert.equal(calls.globalGet, 1);
  await act(async () => { setTestLanguage('zh-CN'); });
  assert.equal(panel.dirty, true);
  assert.equal(panel.editable, true);
  assert.equal(calls.globalGet, 1);
  assert.equal(textareas()[0].value, 'keep-dirty-draft/**');
  assert.equal(textareas()[1].value, 'keep-dirty-block/**');
  assert.match(document.body.textContent, /关闭设置或切换分类/);
  await act(async () => { assert.equal(await panel.save(), true); });
  assert.deepEqual(calls.globalSet, [rules(['keep-dirty-draft/**'], ['keep-dirty-block/**'])]);
  assert.match(document.body.textContent, /已保存/);
});

test('an unavailable duplicate-pattern handler still discloses an already-saved threshold', async () => {
  await renderHook({ scope: 'duplicates' });
  await changeValue(document.querySelector('input[type="number"]'), '12');
  window.api.folders.setDuplicateRules = async () => { throw new Error('No handler registered: setDuplicateRules'); };
  await act(async () => { assert.equal(await panel.save(), false); });
  assert.deepEqual(calls.minimumSet, [[folderA.id, 12]]);
  assert.match(document.body.textContent, /minimum line count was saved, but the patterns could not be saved/);
});


function SideNavHarness({ collapsed }) {
  const location = useLocation();
  const navigate = useNavigate();
  navigateSidebar = navigate;
  return h(React.Fragment, null,
    h(SideNav, { collapsed }),
    h('output', { id: 'sidebar-location' }, location.pathname),
    h('button', { onClick: () => navigate(-1) }, 'Go back'),
  );
}

async function mountSideNav(path = '/', collapsed = false) {
  await act(async () => {
    root.render(h(MemoryRouter, {
      initialEntries: [path],
      future: { v7_startTransition: true, v7_relativeSplatPath: true },
    }, h(I18nProvider, null, h(SideNavHarness, { collapsed }))));
  });
}

function sidebarLinks() { return [...document.querySelectorAll('nav [data-nav-item]')]; }
function currentSidebarLinks() { return sidebarLinks().filter(node => node.getAttribute('aria-current') === 'page'); }

function assertSidebarCurrent(path) {
  assert.deepEqual(currentSidebarLinks().map(node => node.getAttribute('href')), [path]);
  assert.equal(sidebarLinks().filter(node => node.tabIndex === 0).length, 1);
}

test('the root sidebar marks only All repositories as current', async () => {
  await mountSideNav('/');
  const links = sidebarLinks();
  assert.equal(links.length, 4);
  assert.equal(links[0].getAttribute('href'), '/');
  assert.equal(links[0].textContent.trim(), 'All repositories');
  assertSidebarCurrent('/');
  assert.equal(links[0].tabIndex, 0);
});

test('non-root sidebar routes do not falsely activate All repositories', async () => {
  await mountSideNav('/overview');
  assertSidebarCurrent('/overview');
  assert.equal(sidebarLinks()[0].getAttribute('aria-current'), null);
  await act(async () => { navigateSidebar('/code'); });
  assertSidebarCurrent('/code');
  await act(async () => { navigateSidebar('/code/files'); });
  assertSidebarCurrent('/code');
  await act(async () => { navigateSidebar('/architecture'); });
  assertSidebarCurrent('/architecture');
  assert.equal(sidebarLinks()[0].getAttribute('aria-current'), null);
});

test('All repositories navigation retains the active folder and Back restores route selection', async () => {
  await mountSideNav('/code');
  await click(sidebarLinks()[0]);
  assert.equal(document.getElementById('sidebar-location').textContent, '/');
  assert.equal(useAppStore.getState().activeFolderId, folderA.id);
  assertSidebarCurrent('/');
  await click(button('Go back'));
  assert.equal(document.getElementById('sidebar-location').textContent, '/code');
  assert.equal(useAppStore.getState().activeFolderId, folderA.id);
  assertSidebarCurrent('/code');
  assert.equal(sidebarLinks().find(node => node.getAttribute('href') === '/code').tabIndex, 0);
});

test('sidebar Arrow, Home, and End keys rove across all four entries without navigating', async () => {
  await mountSideNav('/');
  const links = sidebarLinks();
  await act(async () => { links[0].focus(); });
  for (let index = 1; index < links.length; index += 1) {
    assert.equal((await key(document.activeElement, 'ArrowDown')).defaultPrevented, true);
    assert.ok(document.activeElement === links[index], `ArrowDown focuses sidebar entry ${index}`);
    assert.equal(links[index].tabIndex, 0);
    assert.equal(links.filter(node => node.tabIndex === 0).length, 1);
  }
  await key(links.at(-1), 'ArrowDown');
  assert.ok(document.activeElement === links[0], 'ArrowDown wraps to All repositories');
  await key(links[0], 'ArrowUp');
  assert.ok(document.activeElement === links.at(-1), 'ArrowUp wraps to Architecture');
  await key(links.at(-1), 'Home');
  assert.ok(document.activeElement === links[0], 'Home returns to All repositories');
  await key(links[0], 'End');
  assert.ok(document.activeElement === links.at(-1), 'End reaches Architecture');
  assert.equal(document.getElementById('sidebar-location').textContent, '/');
  assertSidebarCurrent('/');
});

test('collapsed All repositories has a persistent accessible label and localized destination', async () => {
  window.localStorage.setItem('code-line-analysis-language', 'zh-CN');
  await mountSideNav('/overview', true);
  const links = sidebarLinks();
  assert.equal(links.length, 4);
  assert.equal(links[0].getAttribute('href'), '/');
  assert.equal(links[0].getAttribute('aria-label'), '所有仓库');
  for (const link of links) assert.ok(link.getAttribute('aria-label'), 'Every icon-only link has an accessible name');
  await click(links[0]);
  assert.equal(document.getElementById('sidebar-location').textContent, '/');
  assertSidebarCurrent('/');
  assert.equal(useAppStore.getState().activeFolderId, folderA.id);
});

test('restoring sidebar access preserves the existing folder menu and command-palette routes', async () => {
  const folderMenu = await readFile(new URL('../src/renderer/shell/FolderSwitcher.tsx', import.meta.url), 'utf8');
  const commands = await readFile(new URL('../src/renderer/hooks/useCommands.ts', import.meta.url), 'utf8');
  assert.match(folderMenu, /id: ['"]manage-folders['"][\s\S]*?onSelect: \(\) => navigate\(['"]\/['"]\)/);
  assert.match(commands, /id: ['"]go:workspace['"][\s\S]*?perform: \(\) => navigate\(['"]\/['"]\)/);
});
