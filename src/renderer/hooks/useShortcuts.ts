import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isMac } from '../components/ui/_internal/hooks';
import type { TranslationKey } from '../i18n';
import { useAppStore } from '../store/app-store';
import { useScanStore } from '../store/scan-store';
import { editorPathOf, tabRoute, useTabsStore } from '../store/tabs-store';
import { useFolderActions } from './useFolderActions';

export interface ShortcutRow {
  /** Space-separated chords, each rendered as its own `Kbd`. */
  chord: string;
  labelKey: TranslationKey;
}

export interface ShortcutGroup {
  id: string;
  labelKey: TranslationKey;
  rows: ShortcutRow[];
}

/**
 * The one shortcut table (DESIGN-SYSTEM §8.1). `?` renders it as a `Dialog`
 * (`shell/CommandPaletteHost.tsx`) and this hook binds the global half of it,
 * so the help and the bindings cannot drift apart.
 *
 * Two entries are bound elsewhere, deliberately: `⌘S` is contextual (the
 * editor tab, and the Settings rule editor while its tab is open), and the
 * tree/table row keys belong to `TreeRow` and `DataTable`.
 *
 * **`⌘1…9` addresses tabs, not views.** The blueprint prints `⌘1/⌘2/⌘3` beside
 * the three sidebar views *and* `⌘1…9` for tab jumps; those genuinely collide
 * once two files are open, because the pinned view tab is only tab 1. The
 * digits stay with the tabs — the shared table's meaning — and the three views
 * are addressable by name from `⌘K` instead.
 */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: 'global',
    labelKey: 'shortcuts.groupGlobal',
    rows: [
      { chord: 'Mod+K', labelKey: 'palette.title' },
      { chord: 'Mod+P', labelKey: 'shortcuts.openFiles' },
      { chord: '?', labelKey: 'shortcuts.title' },
      { chord: 'Mod+,', labelKey: 'app.settings' },
      { chord: 'Mod+F', labelKey: 'shortcuts.focusSearch' },
      { chord: 'Mod+R', labelKey: 'app.rescan' },
      { chord: 'Mod+.', labelKey: 'app.cancelScan' },
      { chord: 'Mod+S', labelKey: 'shortcuts.saveContext' },
      { chord: 'Mod+O', labelKey: 'app.addFolder' },
      { chord: 'Mod+\\', labelKey: 'shortcuts.toggleSidebar' },
      { chord: 'Mod+B', labelKey: 'shortcuts.focusExplorer' },
      { chord: 'Escape', labelKey: 'shortcuts.closeLayer' },
    ],
  },
  {
    id: 'tabs',
    labelKey: 'shortcuts.groupTabs',
    rows: [
      { chord: 'Mod+W', labelKey: 'tabs.close' },
      { chord: 'Mod+1-9', labelKey: 'shortcuts.jumpToTab' },
      { chord: 'Alt+ArrowLeft Alt+ArrowRight Ctrl+Tab', labelKey: 'shortcuts.cycleTabs' },
    ],
  },
  {
    id: 'lists',
    labelKey: 'shortcuts.groupLists',
    rows: [
      { chord: 'ArrowUp ArrowDown Home End', labelKey: 'shortcuts.navigateRows' },
      { chord: 'ArrowLeft ArrowRight', labelKey: 'shortcuts.expandCollapse' },
      { chord: 'Enter Space', labelKey: 'shortcuts.activateRow' },
    ],
  },
];

/**
 * The app had **no global shortcuts at all** (DESIGN-SYSTEM §8). This binds the
 * global half of `SHORTCUT_GROUPS`; `⌘S` is contextual and lives with the
 * editor tab (`views/EditorTab.tsx`) and the Settings rule editor.
 */
export function useShortcuts(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const actions = useFolderActions();

  useEffect(() => {
    function currentTabs() {
      const { activeFolderId, lastViewPathByFolder } = useAppStore.getState();
      const files =
        activeFolderId == null ? [] : (useTabsStore.getState().fileTabsByFolder[activeFolderId] ?? []);
      const viewPath = activeFolderId == null ? '/' : (lastViewPathByFolder[activeFolderId] ?? '/overview');
      return { files, viewPath };
    }

    function goToIndex(index: number): void {
      const { files, viewPath } = currentTabs();
      if (index === 0) {
        navigate(viewPath);
        return;
      }
      const tab = files[index - 1];
      if (tab) navigate(tabRoute(tab));
    }

    function activeIndex(): number {
      const relPath = editorPathOf(location.pathname);
      if (relPath == null) return 0;
      const { files } = currentTabs();
      const index = files.findIndex((tab) => tab.relPath === relPath);
      return index < 0 ? 0 : index + 1;
    }

    function cycle(delta: number): void {
      const { files } = currentTabs();
      const count = files.length + 1;
      if (count <= 1) return;
      goToIndex((activeIndex() + delta + count) % count);
    }

    /** `?` must not fire while the user is typing it into a field. */
    function isTyping(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    }

    function onKeyDown(event: KeyboardEvent): void {
      const mod = isMac ? event.metaKey : event.ctrlKey;

      // Settings owns keyboard interaction while modal. Background commands
      // must not move focus, open another layer, or change the scan target.
      // Mod+S is handled by the rule editor; ordinary text editing stays native.
      if (useAppStore.getState().settingsOpen) {
        const key = event.key.toLowerCase();
        const backgroundCommand =
          mod && (/^[1-9]$/.test(key) || ['k', 'p', 'f', 'r', '.', '\\', ',', 'b', 'o', 'w'].includes(key));
        const tabNavigation =
          (event.altKey && (key === 'arrowleft' || key === 'arrowright')) || (event.ctrlKey && key === 'tab');
        if (backgroundCommand || tabNavigation || (key === '?' && !isTyping(event.target)))
          event.preventDefault();
        return;
      }

      if (event.key === '?' && !mod && !event.ctrlKey && !isTyping(event.target)) {
        event.preventDefault();
        useAppStore.getState().setShortcutHelpOpen(true);
        return;
      }

      if (event.altKey && !mod && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        cycle(event.key === 'ArrowRight' ? 1 : -1);
        return;
      }

      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault();
        cycle(event.shiftKey ? -1 : 1);
        return;
      }

      if (!mod || event.altKey) return;

      if (event.key >= '1' && event.key <= '9') {
        event.preventDefault();
        goToIndex(Number(event.key) - 1);
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'k': {
          // `⌘K` is reserved for the palette and nothing else (§8.1). It
          // toggles, so the same chord dismisses it.
          event.preventDefault();
          const { paletteOpen, setPaletteOpen } = useAppStore.getState();
          setPaletteOpen(!paletteOpen, 'all');
          break;
        }
        case 'p': {
          // The same palette, pre-filtered to Open ▸ files.
          event.preventDefault();
          useAppStore.getState().setPaletteOpen(true, 'files');
          break;
        }
        case 'f': {
          // Every view marks its own search box with `data-view-search`; Esc
          // then clears it and a second Esc blurs it (`SearchInput`).
          const search = document.querySelector<HTMLInputElement>('[data-view-search]');
          if (!search) return;
          event.preventDefault();
          search.focus();
          search.select();
          break;
        }
        case 'r': {
          event.preventDefault();
          actions.rescan();
          break;
        }
        case '.': {
          event.preventDefault();
          useScanStore.getState().cancel();
          break;
        }
        case '\\': {
          event.preventDefault();
          useAppStore.getState().toggleSidebar();
          break;
        }
        case ',': {
          event.preventDefault();
          useAppStore.getState().setSettingsOpen(true);
          break;
        }
        case 'b': {
          event.preventDefault();
          // The Explorer only renders its rows when the sidebar is expanded, so
          // uncollapse first and focus on the next frame.
          if (useAppStore.getState().sidebarCollapsed) useAppStore.getState().toggleSidebar();
          window.requestAnimationFrame(() => {
            const tree = document.querySelector<HTMLElement>('[data-explorer-tree]');
            const row =
              tree?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]') ??
              tree?.querySelector<HTMLElement>('[role="treeitem"]');
            row?.focus();
          });
          break;
        }
        case 'o': {
          event.preventDefault();
          void actions.addFolder();
          break;
        }
        case 'w': {
          if (editorPathOf(location.pathname) == null) return;
          event.preventDefault();
          const { files } = currentTabs();
          const tab = files[activeIndex() - 1];
          // The shell owns the close: it guards unsaved work and navigates.
          if (tab) useTabsStore.getState().requestClose([tab.id]);
          break;
        }
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions, location.pathname, navigate]);
}
