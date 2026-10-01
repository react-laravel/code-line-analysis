import { create } from 'zustand';
import type { DirNode, FolderRow, FolderStats, GitRepoInfo } from '../../shared/api';
import type { RuleScope } from '../components/ui';
import { readPersisted, writePersisted } from './persist';

/** The four tabs of the Settings dialog (blueprint §2.7). */
export type SettingsTab = 'general' | 'rules' | 'appearance' | 'about';

/**
 * `all` is `⌘K`. `files` is `⌘P` — the same palette, pre-filtered to the
 * Open ▸ files section (blueprint §4.2).
 */
export type PaletteMode = 'all' | 'files';

/**
 * The application spine. Replaces the 15 `useState`/`useRef` slots that used to
 * live in `App.tsx`, including the `scanRevision` counter that was prop-drilled
 * into nine pages purely as a cache-buster.
 *
 * Persisted here (blueprint §3.1/§3.3): the active folder, the sidebar collapse
 * state, the auto-scan preference, and the last view route per folder — so
 * switching folders keeps you on the same view.
 */
export interface AppState {
  folders: FolderRow[];
  foldersLoaded: boolean;
  activeFolderId: number | null;
  /** Bumped when a scan finishes; every page reads it instead of a prop. */
  revision: number;
  summary: FolderStats | null;
  /** `null` until detection has answered for the active folder. */
  laravelByFolder: Record<number, boolean>;
  sidebarCollapsed: boolean;
  settingsOpen: boolean;
  /** Which Settings tab to show, and which rule scope inside it. */
  settingsTab: SettingsTab;
  settingsScope: RuleScope;
  /** `⌘K` / `⌘P` (blueprint §2.8). */
  paletteOpen: boolean;
  paletteMode: PaletteMode;
  /** `?` — the shortcut-help dialog, generated from the same table. */
  shortcutHelpOpen: boolean;
  /** Set by `requestRemoveFolder`; the shell renders the ConfirmDialog. */
  pendingRemoveFolder: FolderRow | null;
  /** Opt-in (blueprint §3.1) — scanning used to fire unprompted on launch. */
  autoScanOnOpen: boolean;
  /** Restore the last-used folder on launch (blueprint §2.7 General). */
  restoreLastFolder: boolean;
  /** The default `detectDuplicates` flag for every scan trigger. */
  detectDuplicatesOnScan: boolean;
  expandedTreePathsByFolder: Record<number, string[]>;
  lastViewPathByFolder: Record<number, string>;
  /** Overview → Activity panel disclosure, per folder (blueprint §2.2). */
  activityOpenByFolder: Record<number, boolean>;
  /**
   * The directory tree the sidebar Explorer is showing for the active folder.
   * It lives here rather than inside the component so the expand-all / level
   * actions can also be driven from outside it (overflow menu today, command
   * palette in chunk 11).
   */
  explorerTree: DirNode | null;
  /**
   * `git.repoInfo` per folder, keyed by id — read by the Workspace table and by
   * the titlebar folder `Combobox`, which both show the last-commit age
   * (blueprint §2.6 / §3.3). One cache so the two surfaces cannot disagree and
   * the git call is not made twice.
   */
  repoInfoByFolder: Record<number, GitRepoInfo | null>;

  refreshFolders: () => Promise<FolderRow[]>;
  setActiveFolderId: (id: number | null) => void;
  bumpRevision: () => void;
  setSummary: (summary: FolderStats | null) => void;
  setLaravel: (folderId: number, isLaravel: boolean) => void;
  toggleSidebar: () => void;
  setSettingsOpen: (open: boolean) => void;
  /** Open Settings straight onto a tab — and, for `rules`, onto a scope. */
  openSettings: (tab?: SettingsTab, scope?: RuleScope) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  setSettingsScope: (scope: RuleScope) => void;
  setPaletteOpen: (open: boolean, mode?: PaletteMode) => void;
  setShortcutHelpOpen: (open: boolean) => void;
  setPendingRemoveFolder: (folder: FolderRow | null) => void;
  setAutoScanOnOpen: (enabled: boolean) => void;
  setRestoreLastFolder: (enabled: boolean) => void;
  setDetectDuplicatesOnScan: (enabled: boolean) => void;
  toggleTreePath: (folderId: number, treePath: string, open: boolean) => void;
  replaceTreePaths: (folderId: number, paths: string[]) => void;
  setExplorerTree: (tree: DirNode | null) => void;
  /** Fetches `git.repoInfo` for folders that have no entry yet; `force` refetches all. */
  loadRepoInfo: (options?: { force?: boolean }) => Promise<void>;
  rememberViewPath: (folderId: number, path: string) => void;
  setActivityOpen: (folderId: number, open: boolean) => void;
}

const ACTIVE_FOLDER_KEY = 'active-folder';
const SIDEBAR_KEY = 'sidebar-collapsed';
const AUTO_SCAN_KEY = 'auto-scan-on-open';
const RESTORE_FOLDER_KEY = 'restore-last-folder';
const DETECT_DUPLICATES_KEY = 'detect-duplicates-on-scan';
const VIEW_PATH_KEY = 'view-path-by-folder';
const ACTIVITY_OPEN_KEY = 'activity-open-by-folder';
let duplicatePreferenceVersion = 0;
let duplicatePreferenceSynced = false;
let duplicatePreferenceWrites: Promise<void> = Promise.resolve();

function writeDuplicatePreference(enabled: boolean): Promise<void> {
  duplicatePreferenceWrites = duplicatePreferenceWrites.catch(() => undefined).then(async () => {
    if (typeof window.api.settings?.setDetectDuplicates === 'function') {
      await window.api.settings.setDetectDuplicates(enabled);
    }
  });
  return duplicatePreferenceWrites;
}

/** Routes that no longer exist; a persisted entry pointing at one would land on
 *  an empty outlet. `/tree` became the sidebar Explorer; `/dashboard` and
 *  `/heatmap` merged into `/overview`; `/files`, `/top`, `/tags` and
 *  `/duplicates` merged into `/code` as its four lenses; `/api-routes`,
 *  `/relations` and `/laravel-schema` merged into `/architecture` as its
 *  three lenses; `/folders` became Settings → Scan rules, `scope="folder"`. */
const RETIRED_VIEW_PATHS = [
  '/tree',
  '/dashboard',
  '/heatmap',
  '/folders',
  '/files',
  '/top',
  '/tags',
  '/duplicates',
  '/api-routes',
  '/relations',
  '/laravel-schema',
];

function sanitizeViewPaths(map: Record<number, string>): Record<number, string> {
  const clean: Record<number, string> = {};
  for (const [folderId, path] of Object.entries(map)) {
    if (RETIRED_VIEW_PATHS.some(retired => path === retired || path.startsWith(`${retired}?`))) continue;
    clean[Number(folderId)] = path;
  }
  return clean;
}

export const useAppStore = create<AppState>((set, get) => ({
  folders: [],
  foldersLoaded: false,
  // "Restore the last folder on launch" is a real preference now: with it off
  // the app boots with no folder selected, whatever was persisted last.
  activeFolderId: readPersisted<boolean>(RESTORE_FOLDER_KEY, true)
    ? readPersisted<number | null>(ACTIVE_FOLDER_KEY, null)
    : null,
  revision: 0,
  summary: null,
  laravelByFolder: {},
  sidebarCollapsed: readPersisted<boolean>(SIDEBAR_KEY, false),
  settingsOpen: false,
  settingsTab: 'general',
  settingsScope: 'global',
  paletteOpen: false,
  paletteMode: 'all',
  shortcutHelpOpen: false,
  pendingRemoveFolder: null,
  autoScanOnOpen: readPersisted<boolean>(AUTO_SCAN_KEY, false),
  restoreLastFolder: readPersisted<boolean>(RESTORE_FOLDER_KEY, true),
  detectDuplicatesOnScan: readPersisted<boolean>(DETECT_DUPLICATES_KEY, true),
  expandedTreePathsByFolder: {},
  lastViewPathByFolder: sanitizeViewPaths(readPersisted<Record<number, string>>(VIEW_PATH_KEY, {})),
  activityOpenByFolder: readPersisted<Record<number, boolean>>(ACTIVITY_OPEN_KEY, {}),
  explorerTree: null,
  repoInfoByFolder: {},

  async refreshFolders() {
    if (!duplicatePreferenceSynced && typeof window.api.settings?.getDetectDuplicates === 'function') {
      const version = duplicatePreferenceVersion;
      try {
        const persisted = readPersisted<boolean | null>(DETECT_DUPLICATES_KEY, null);
        const enabled = persisted ?? await window.api.settings.getDetectDuplicates();
        if (version === duplicatePreferenceVersion) {
          set({ detectDuplicatesOnScan: enabled });
          writePersisted(DETECT_DUPLICATES_KEY, enabled);
          await writeDuplicatePreference(enabled);
        }
        duplicatePreferenceSynced = true;
      } catch (error) {
        console.error('Synchronizing duplicate detection preference failed:', error);
      }
    }
    const list = await window.api.folders.list();
    const currentId = get().activeFolderId;
    // Restore the last-used folder instead of `list[0]`, which — because
    // `folders.rs:173` orders `created_at DESC` — is the newest *added* one.
    const nextId = currentId != null && list.some(folder => folder.id === currentId) ? currentId : null;
    set({ folders: list, foldersLoaded: true });
    if (nextId !== currentId) get().setActiveFolderId(nextId);
    return list;
  },

  setActiveFolderId(id) {
    if (get().activeFolderId === id) return;
    writePersisted(ACTIVE_FOLDER_KEY, id);
    set({ activeFolderId: id, summary: null, explorerTree: null });
  },

  bumpRevision() {
    set(state => ({ revision: state.revision + 1 }));
  },

  setSummary(summary) {
    set({ summary });
  },

  setLaravel(folderId, isLaravel) {
    set(state => ({ laravelByFolder: { ...state.laravelByFolder, [folderId]: isLaravel } }));
  },

  toggleSidebar() {
    const next = !get().sidebarCollapsed;
    writePersisted(SIDEBAR_KEY, next);
    set({ sidebarCollapsed: next });
  },

  setSettingsOpen(open) {
    set({ settingsOpen: open });
  },

  openSettings(tab = 'general', scope) {
    set(state => ({
      settingsOpen: true,
      paletteOpen: false,
      settingsTab: tab,
      settingsScope: scope ?? state.settingsScope,
    }));
  },

  setSettingsTab(tab) {
    set({ settingsTab: tab });
  },

  setSettingsScope(scope) {
    set({ settingsScope: scope });
  },

  setPaletteOpen(open, mode) {
    set({ paletteOpen: open, paletteMode: open ? mode ?? 'all' : 'all' });
  },

  setShortcutHelpOpen(open) {
    set({ shortcutHelpOpen: open });
  },

  setPendingRemoveFolder(folder) {
    set({ pendingRemoveFolder: folder });
  },

  setAutoScanOnOpen(enabled) {
    writePersisted(AUTO_SCAN_KEY, enabled);
    set({ autoScanOnOpen: enabled });
  },

  setRestoreLastFolder(enabled) {
    writePersisted(RESTORE_FOLDER_KEY, enabled);
    set({ restoreLastFolder: enabled });
  },

  setDetectDuplicatesOnScan(enabled) {
    duplicatePreferenceVersion += 1;
    writePersisted(DETECT_DUPLICATES_KEY, enabled);
    set({ detectDuplicatesOnScan: enabled });
    void writeDuplicatePreference(enabled).catch(error => {
      console.error('Saving duplicate detection preference failed:', error);
    });
  },

  toggleTreePath(folderId, treePath, open) {
    set(state => {
      const paths = new Set(state.expandedTreePathsByFolder[folderId] ?? ['']);
      if (open) paths.add(treePath);
      else paths.delete(treePath);
      return {
        expandedTreePathsByFolder: { ...state.expandedTreePathsByFolder, [folderId]: Array.from(paths) },
      };
    });
  },

  replaceTreePaths(folderId, paths) {
    set(state => ({
      expandedTreePathsByFolder: {
        ...state.expandedTreePathsByFolder,
        [folderId]: Array.from(new Set(paths.filter(Boolean))),
      },
    }));
  },

  setExplorerTree(tree) {
    set({ explorerTree: tree });
  },

  async loadRepoInfo(options) {
    const { folders, repoInfoByFolder } = get();
    const wanted = options?.force
      ? folders
      : folders.filter(folder => !(folder.id in repoInfoByFolder));
    if (wanted.length === 0) return;

    const entries = await Promise.all(wanted.map(async folder => {
      if (!folder.isAvailable) return [folder.id, null] as const;
      try {
        return [folder.id, await window.api.git.repoInfo(folder.id)] as const;
      } catch {
        return [folder.id, null] as const;
      }
    }));

    set(state => {
      const next = { ...state.repoInfoByFolder };
      for (const [folderId, info] of entries) next[folderId] = info;
      return { repoInfoByFolder: next };
    });
  },

  rememberViewPath(folderId, path) {
    set(state => {
      if (state.lastViewPathByFolder[folderId] === path) return state;
      const next = { ...state.lastViewPathByFolder, [folderId]: path };
      writePersisted(VIEW_PATH_KEY, next);
      return { lastViewPathByFolder: next };
    });
  },

  setActivityOpen(folderId, open) {
    set(state => {
      const next = { ...state.activityOpenByFolder, [folderId]: open };
      writePersisted(ACTIVITY_OPEN_KEY, next);
      return { activityOpenByFolder: next };
    });
  },
}));

/** The revision counter every page uses in place of the old `scanRevision` prop. */
export function useRevision(): number {
  return useAppStore(state => state.revision);
}

export function useActiveFolder(): FolderRow | null {
  return useAppStore(
    state => state.folders.find(folder => folder.id === state.activeFolderId) ?? null,
  );
}

/** `null` while detection has not answered yet for this folder. */
export function useActiveIsLaravel(): boolean | null {
  return useAppStore(state => {
    if (state.activeFolderId == null) return null;
    const detected = state.laravelByFolder[state.activeFolderId];
    return detected === undefined ? null : detected;
  });
}
