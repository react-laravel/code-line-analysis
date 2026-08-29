import { create } from 'zustand';
import { readPersisted, writePersisted } from './persist';

/**
 * Document tabs, scoped per folder and persisted across relaunch
 * (blueprint §1.1 tabstrip, §3.4 "find a location → open it").
 *
 * The tab strip always carries one pinned **view** tab — whichever
 * non-editor route the folder was last on — plus one tab per open file. This
 * is what makes deleting the `sourceNav` router-state hack safe: the strip,
 * not the sidebar highlight, is what tells you where you are.
 *
 * A file tab also carries its **unsaved buffer** (`draft`), so switching tabs
 * or leaving the editor no longer throws the edit away. That is what makes the
 * dirty dot honest, and it is why closing a dirty tab has something to confirm.
 */
export interface FileTab {
  id: string;
  folderId: number;
  relPath: string;
  /** Deep-link query string including the leading `?` (line/endLine/highlight). */
  search: string;
  /** Unsaved editor buffer. `undefined` means "same as disk" — i.e. not dirty. */
  draft?: string;
}

/**
 * A close request in flight. `confirm` is set when at least one of the targets
 * has unsaved work, in which case the shell shows a `ConfirmDialog` instead of
 * closing (DESIGN-SYSTEM §7.5 — never `window.confirm`).
 */
export interface PendingClose {
  ids: string[];
  confirm: boolean;
  /** File names with unsaved work, for the dialog subject. */
  dirtyTitles: string[];
}

export interface TabsState {
  fileTabsByFolder: Record<number, FileTab[]>;
  /**
   * Most-recent-first rel paths per folder, 20 deep and persisted — the
   * command palette's `Open ▸ Recent` section (blueprint §2.8). A file leaves
   * the tab strip when it is closed; it stays here.
   */
  recentByFolder: Record<number, string[]>;
  pendingClose: PendingClose | null;

  openFile: (folderId: number, relPath: string, search?: string) => FileTab;
  /** Ask to close tabs. Always goes through `pendingClose` so there is exactly
   *  one close path, guarded or not; the shell resolves it and navigates. */
  requestClose: (ids: string[]) => void;
  clearPendingClose: () => void;
  closeTabs: (ids: string[]) => void;
  /** `null` clears the buffer (saved or reverted) and with it the dirty dot. */
  setDraft: (id: string, draft: string | null) => void;
  reorder: (folderId: number, from: number, to: number) => void;
  dropFolder: (folderId: number) => void;
}

const TABS_KEY = 'file-tabs';
const RECENT_KEY = 'recent-files';
const RECENT_LIMIT = 20;

/** Stable empty reference — a fresh array from a selector re-renders forever. */
const EMPTY: FileTab[] = [];

export const EDITOR_PREFIX = '/editor/';

/**
 * The rel path carried by an `/editor/:relPath` route, or `null` for any other
 * route. One decoder — the shell, the Explorer and the shortcut hook all read
 * the active file through this.
 */
export function editorPathOf(pathname: string): string | null {
  if (!pathname.startsWith(EDITOR_PREFIX)) return null;
  const raw = pathname.slice(EDITOR_PREFIX.length);
  try {
    return decodeURIComponent(raw);
  } catch {
    // Keep the raw segment when it is not valid percent-encoding.
    return raw;
  }
}

/**
 * How the content pane is laid out. `document` is a full-bleed flex child
 * (the editor). `report` is a padded, restored ScrollArea. Owned next to
 * `editorPathOf` so the shell never sniffs a path for chrome reasons.
 */
export type ContentLayout = 'document' | 'report';

export function contentLayoutOf(pathname: string): ContentLayout {
  return editorPathOf(pathname) ? 'document' : 'report';
}

export function tabId(folderId: number, relPath: string): string {
  return `${folderId}:${relPath}`;
}

/** The route a tab points at — the editor route shape is unchanged. */
export function tabRoute(tab: FileTab): string {
  return `${EDITOR_PREFIX}${encodeURIComponent(tab.relPath)}${tab.search}`;
}

export function tabTitle(tab: FileTab): string {
  return tab.relPath.split('/').pop() || tab.relPath;
}

export function isTabDirty(tab: FileTab): boolean {
  return tab.draft !== undefined;
}

/**
 * Where to go once `closingIds` are gone: the nearest surviving tab to the
 * right, else to the left, else back to the pinned view tab. `null` means the
 * active tab is not being closed, so nothing moves.
 */
export function routeAfterClosing(
  files: FileTab[],
  closingIds: string[],
  activeId: string | null,
  viewPath: string,
): string | null {
  if (activeId == null || !closingIds.includes(activeId)) return null;
  const index = files.findIndex(tab => tab.id === activeId);
  if (index < 0) return viewPath;
  for (let cursor = index + 1; cursor < files.length; cursor += 1) {
    if (!closingIds.includes(files[cursor].id)) return tabRoute(files[cursor]);
  }
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (!closingIds.includes(files[cursor].id)) return tabRoute(files[cursor]);
  }
  return viewPath;
}

function persist(map: Record<number, FileTab[]>): void {
  const clean: Record<number, FileTab[]> = {};
  for (const [folderId, tabs] of Object.entries(map)) {
    // Unsaved buffers are session state; a relaunch must not resurrect them.
    clean[Number(folderId)] = tabs.map(({ draft: _draft, ...rest }) => rest);
  }
  writePersisted(TABS_KEY, clean);
}

export const useTabsStore = create<TabsState>((set, get) => ({
  fileTabsByFolder: readPersisted<Record<number, FileTab[]>>(TABS_KEY, {}),
  recentByFolder: readPersisted<Record<number, string[]>>(RECENT_KEY, {}),
  pendingClose: null,

  openFile(folderId, relPath, search = '') {
    const id = tabId(folderId, relPath);
    const tab: FileTab = { id, folderId, relPath, search };
    set(state => {
      const previousRecent = state.recentByFolder[folderId] ?? [];
      const recent = previousRecent[0] === relPath
        ? state.recentByFolder
        : {
            ...state.recentByFolder,
            [folderId]: [relPath, ...previousRecent.filter(item => item !== relPath)].slice(0, RECENT_LIMIT),
          };
      if (recent !== state.recentByFolder) writePersisted(RECENT_KEY, recent);

      const tabs = state.fileTabsByFolder[folderId] ?? EMPTY;
      const existing = tabs.find(item => item.id === id);
      // Idempotent: re-navigating to the same deep link must not churn state.
      if (existing && existing.search === search) {
        return recent === state.recentByFolder ? state : { recentByFolder: recent };
      }
      const next = existing
        ? tabs.map(item => (item.id === id ? { ...item, search } : item))
        : [...tabs, tab];
      const map = { ...state.fileTabsByFolder, [folderId]: next };
      persist(map);
      return { fileTabsByFolder: map, recentByFolder: recent };
    });
    return tab;
  },

  requestClose(ids) {
    if (ids.length === 0) return;
    const dirtyTitles = Object.values(get().fileTabsByFolder)
      .flat()
      .filter(tab => ids.includes(tab.id) && isTabDirty(tab))
      .map(tabTitle);
    set({ pendingClose: { ids, confirm: dirtyTitles.length > 0, dirtyTitles } });
  },

  clearPendingClose() {
    set(state => (state.pendingClose === null ? state : { pendingClose: null }));
  },

  closeTabs(ids) {
    if (ids.length === 0) return;
    set(state => {
      const map = { ...state.fileTabsByFolder };
      let changed = false;
      for (const key of Object.keys(map)) {
        const folderId = Number(key);
        const tabs = map[folderId];
        const next = tabs.filter(tab => !ids.includes(tab.id));
        if (next.length === tabs.length) continue;
        map[folderId] = next;
        changed = true;
      }
      if (!changed) return state;
      persist(map);
      return { fileTabsByFolder: map };
    });
  },

  setDraft(id, draft) {
    set(state => {
      const map = { ...state.fileTabsByFolder };
      let changed = false;
      for (const key of Object.keys(map)) {
        const folderId = Number(key);
        const tabs = map[folderId];
        const index = tabs.findIndex(tab => tab.id === id);
        if (index < 0) continue;
        const current = tabs[index].draft;
        if (draft === null ? current === undefined : current === draft) continue;
        const next = tabs.slice();
        if (draft === null) {
          const { draft: _draft, ...rest } = next[index];
          next[index] = rest;
        } else {
          next[index] = { ...next[index], draft };
        }
        map[folderId] = next;
        changed = true;
      }
      // Drafts are never persisted, so no `persist()` here.
      return changed ? { fileTabsByFolder: map } : state;
    });
  },

  reorder(folderId, from, to) {
    set(state => {
      const tabs = state.fileTabsByFolder[folderId];
      if (!tabs || from === to || from < 0 || to < 0 || from >= tabs.length || to >= tabs.length) {
        return state;
      }
      const next = tabs.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      const map = { ...state.fileTabsByFolder, [folderId]: next };
      persist(map);
      return { fileTabsByFolder: map };
    });
  },

  dropFolder(folderId) {
    set(state => {
      const hadTabs = folderId in state.fileTabsByFolder;
      const hadRecent = folderId in state.recentByFolder;
      if (!hadTabs && !hadRecent) return state;

      const map = { ...state.fileTabsByFolder };
      delete map[folderId];
      if (hadTabs) persist(map);

      const recent = { ...state.recentByFolder };
      delete recent[folderId];
      if (hadRecent) writePersisted(RECENT_KEY, recent);

      return { fileTabsByFolder: map, recentByFolder: recent, pendingClose: null };
    });
  },
}));

/** Subscribing selector — reading through an action would not re-render. */
export function useFileTabs(folderId: number | null): FileTab[] {
  return useTabsStore(state => (folderId == null ? EMPTY : state.fileTabsByFolder[folderId] ?? EMPTY));
}

/** Stable empty reference for the recents selector. */
const EMPTY_RECENT: string[] = [];

/** Most-recent-first rel paths for the palette's `Open ▸ Recent` section. */
export function useRecentFiles(folderId: number | null): string[] {
  return useTabsStore(state => (folderId == null ? EMPTY_RECENT : state.recentByFolder[folderId] ?? EMPTY_RECENT));
}
