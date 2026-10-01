import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Braces,
  Copy,
  Database,
  FileCode2,
  Files,
  FolderOpen,
  FolderPlus,
  FolderTree,
  GitBranch,
  Languages,
  ListTree,
  Moon,
  PanelLeft,
  RefreshCw,
  Keyboard,
  Route as RouteIcon,
  Settings,
  Share2,
  Square,
  Tags,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { TopFile } from '../../shared/api';
import { isActionableMenuItem, type MenuItem } from '../components/ui/_internal/types';
import type { Command } from '../components/ui/command-palette';
import type { RuleScope } from '../components/ui/rule-editor';
import { loadFileIndex } from '../lib/file-index';
import { collectDirectoryPaths, pathsForLevel } from '../lib/tree-nodes';
import { useI18n, type TranslationKey } from '../i18n';
import { useTheme } from '../theme';
import { useActiveFolder, useAppStore } from '../store/app-store';
import { useScanStore } from '../store/scan-store';
import { tabRoute, useFileTabs, useRecentFiles } from '../store/tabs-store';
import { useFolderActions } from './useFolderActions';

/* ------------------------------------------------------------------ registry */

type CommandSource = () => Command[];

/**
 * Contextual commands contributed by whatever view is mounted. A module-level
 * map rather than a store: nothing needs to re-render when a source registers,
 * because the palette rebuilds its list every time it opens.
 */
const sources = new Map<string, CommandSource>();

/**
 * Publish a mounted surface's verbs to `⌘K` for as long as it is on screen.
 * `build` may close over render-scoped values; it is read through a ref, so
 * passing a fresh function every render is safe and does not re-register.
 */
export function useRegisterCommands(scopeId: string, build: CommandSource): void {
  const latest = useRef(build);
  latest.current = build;

  useEffect(() => {
    const source: CommandSource = () => latest.current();
    sources.set(scopeId, source);
    return () => {
      if (sources.get(scopeId) === source) sources.delete(scopeId);
    };
  }, [scopeId]);
}

/**
 * Adapt a `⋯` overflow menu into palette commands. The toolbar overflow is
 * already the list of demoted, low-frequency actions for the current surface,
 * so it is exactly the set DESIGN-SYSTEM §9 rule 1 requires to also be one
 * keystroke away. Separators and labels drop out; submenus flatten.
 */
export function commandsFromMenu(
  scopeId: string,
  items: MenuItem[],
  context: { hint?: ReactNode; keywords?: string; prefix?: string },
): Command[] {
  const out: Command[] = [];

  function walk(list: MenuItem[], trail: string): void {
    for (const item of list) {
      if (!isActionableMenuItem(item)) continue;
      if (item.kind === 'submenu') {
        walk(item.items, typeof item.label === 'string' ? item.label : trail);
        continue;
      }
      if (typeof item.label !== 'string') continue;
      const title = [context.prefix, trail || null, item.label].filter(Boolean).join(' · ');
      out.push({
        id: `${scopeId}:${item.id}`,
        title,
        group: 'action',
        hint: context.hint,
        keywords: context.keywords,
        disabled: item.disabled,
        shortcut: item.kind === 'checkbox' ? undefined : item.shortcut,
        perform: item.onSelect,
      });
    }
  }

  walk(items, '');
  return out;
}

/* ------------------------------------------------------------------ commands */

interface NavTarget {
  id: string;
  to: string;
  icon: LucideIcon;
  viewKey: TranslationKey;
  lensKey?: TranslationKey;
}

/** The three views and their lenses — the whole nav, addressable by name. */
const NAV_TARGETS: NavTarget[] = [
  { id: 'overview', to: '/overview', icon: BarChart3, viewKey: 'nav.overview' },
  { id: 'code', to: '/code', icon: Files, viewKey: 'nav.code', lensKey: 'nav.files' },
  { id: 'code-functions', to: '/code?lens=functions', icon: Braces, viewKey: 'nav.code', lensKey: 'nav.top' },
  { id: 'code-markers', to: '/code?lens=markers', icon: Tags, viewKey: 'nav.code', lensKey: 'nav.tags' },
  { id: 'code-duplicates', to: '/code?lens=duplicates', icon: Copy, viewKey: 'nav.code', lensKey: 'nav.duplicates' },
  {
    id: 'architecture',
    to: '/architecture',
    icon: RouteIcon,
    viewKey: 'nav.architecture',
    lensKey: 'nav.apiRoutes',
  },
  {
    id: 'architecture-imports',
    to: '/architecture?lens=imports',
    icon: Share2,
    viewKey: 'nav.architecture',
    lensKey: 'nav.relations',
  },
  {
    id: 'architecture-schema',
    to: '/architecture?lens=schema',
    icon: Database,
    viewKey: 'nav.architecture',
    lensKey: 'nav.laravelSchema',
  },
];

const RULE_SCOPES: RuleScope[] = ['global', 'folder', 'duplicates'];

function fileName(relPath: string): string {
  return relPath.split('/').pop() || relPath;
}

/**
 * The command registry (blueprint §2.8). Grouped Navigate · Actions · Open ·
 * Settings, verb-capable, and never empty — with no query the palette shows
 * recents first and then everything in group order.
 *
 * Every feature this redesign demoted off a primary surface is registered
 * here. That is the condition that makes the IA curation non-lossy
 * (DESIGN-SYSTEM §9 rule 1).
 *
 * @param active `true` while the palette is open — gates the one lazy fetch
 * (the folder's file list, for `Open ▸ file`).
 */
export function useCommands(active: boolean): Command[] {
  const { language, languageOptions, setLanguage, t } = useI18n();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const actions = useFolderActions();

  const folder = useActiveFolder();
  const folders = useAppStore(state => state.folders);
  const explorerTree = useAppStore(state => state.explorerTree);
  const sidebarCollapsed = useAppStore(state => state.sidebarCollapsed);
  const scanStatus = useScanStore(state => state.status);

  const folderId = folder?.id ?? null;
  const fileTabs = useFileTabs(folderId);
  const recent = useRecentFiles(folderId);

  // The complete paginated index is loaded only while the palette is open.
  const revision = useAppStore(state => state.revision);
  const [files, setFiles] = useState<TopFile[]>([]);
  useEffect(() => {
    if (!active || folderId == null) return;
    let ignore = false;
    void loadFileIndex(folderId)
      .then(next => {
        if (!ignore) setFiles(next);
      })
      .catch(() => {
        if (!ignore) setFiles([]);
      });
    return () => {
      ignore = true;
    };
  }, [active, folderId, revision]);

  useEffect(() => {
    setFiles([]);
  }, [folderId]);

  return useMemo(() => {
    const scanning = scanStatus === 'running' || scanStatus === 'queued';
    const noFolder = folder == null;
    const list: Command[] = [];

    /* -------------------------------------------------------------- navigate */

    for (const target of NAV_TARGETS) {
      const view = t(target.viewKey);
      list.push({
        id: `go:${target.id}`,
        group: 'navigate',
        icon: target.icon,
        title: target.lensKey ? t('palette.viewLens', { view, lens: t(target.lensKey) }) : view,
        keywords: `${view} ${target.lensKey ? t(target.lensKey) : ''} ${target.to}`,
        disabled: noFolder,
        disabledReason: t('palette.noFolder'),
        perform: () => navigate(target.to),
      });
    }

    list.push({
      id: 'go:workspace',
      group: 'navigate',
      icon: FolderTree,
      title: t('nav.workspace'),
      keywords: t('app.manageFolders'),
      perform: () => navigate('/'),
    });

    list.push({
      id: 'go:explorer',
      group: 'navigate',
      icon: FolderOpen,
      title: t('palette.focusExplorer'),
      shortcut: 'Mod+B',
      perform: () => {
        if (useAppStore.getState().sidebarCollapsed) useAppStore.getState().toggleSidebar();
        window.requestAnimationFrame(() => {
          const tree = document.querySelector<HTMLElement>('[data-explorer-tree]');
          const row = tree?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')
            ?? tree?.querySelector<HTMLElement>('[role="treeitem"]');
          row?.focus();
        });
      },
    });

    /* --------------------------------------------------------------- actions */

    const canScan = folder != null && folder.isAvailable;

    list.push(
      {
        id: 'action:rescan',
        group: 'action',
        icon: RefreshCw,
        title: t('app.rescanFull'),
        shortcut: 'Mod+R',
        disabled: !canScan || scanning,
        disabledReason: t('palette.noFolder'),
        perform: () => actions.rescan({ detectDuplicates: true }),
      },
      {
        id: 'action:rescan-no-duplicates',
        group: 'action',
        icon: RefreshCw,
        title: t('app.rescanWithoutDuplicates'),
        disabled: !canScan || scanning,
        disabledReason: t('palette.noFolder'),
        perform: () => actions.rescan({ detectDuplicates: false }),
      },
      {
        id: 'action:cancel-scan',
        group: 'action',
        icon: Square,
        title: t('app.cancelScan'),
        shortcut: 'Mod+.',
        disabled: !scanning,
        perform: () => actions.cancelScan(),
      },
      {
        id: 'action:add-folder',
        group: 'action',
        icon: FolderPlus,
        title: t('app.addFolder'),
        shortcut: 'Mod+O',
        perform: () => void actions.addFolder(),
      },
      {
        id: 'action:add-git-repositories',
        group: 'action',
        icon: GitBranch,
        title: t('workspace.addGitRepositories'),
        perform: () => void actions.addGitRepositories(),
      },
      {
        id: 'action:relocate',
        group: 'action',
        icon: FolderOpen,
        title: t('workspace.relocate'),
        hint: folder?.name,
        disabled: noFolder,
        disabledReason: t('palette.noFolder'),
        perform: () => {
          if (folder) void actions.relocateFolder(folder);
        },
      },
      {
        id: 'action:refresh-git',
        group: 'action',
        icon: GitBranch,
        title: t('workspace.refreshGitInfo'),
        perform: () => void useAppStore.getState().loadRepoInfo({ force: true }),
      },
      {
        id: 'action:remove-folder',
        group: 'action',
        icon: Trash2,
        title: t('folderManager.remove'),
        hint: folder?.name,
        disabled: noFolder,
        disabledReason: t('palette.noFolder'),
        perform: () => {
          if (folder) actions.requestRemoveFolder(folder);
        },
      },
    );

    // The Explorer's expand-all / level 1·2·3 verbs (blueprint §1.2). They read
    // the tree the Explorer already loaded — there is no second `stats.tree`
    // fetch — and the pure helpers moved out of the old tree page unchanged.
    const treeReady = explorerTree != null && folderId != null;
    const applyPaths = (paths: string[]): void => {
      if (folderId != null) useAppStore.getState().replaceTreePaths(folderId, paths);
    };

    list.push(
      {
        id: 'action:tree-expand-all',
        group: 'action',
        icon: ListTree,
        title: t('tree.expandAll'),
        disabled: !treeReady,
        perform: () => {
          if (explorerTree) applyPaths(collectDirectoryPaths(explorerTree).allPaths);
        },
      },
      {
        id: 'action:tree-collapse-all',
        group: 'action',
        icon: ListTree,
        title: t('tree.collapseAll'),
        disabled: !treeReady,
        perform: () => applyPaths(['']),
      },
    );

    for (const level of [1, 2, 3]) {
      list.push({
        id: `action:tree-level-${level}`,
        group: 'action',
        icon: ListTree,
        title: t('tree.expandLevel', { count: level }),
        keywords: t('tree.expandAll'),
        disabled: !treeReady,
        perform: () => {
          if (explorerTree) applyPaths(pathsForLevel(explorerTree, level));
        },
      });
    }

    /* ------------------------------------------------------------------ open */

    for (const item of folders) {
      if (item.id === folderId) continue;
      list.push({
        id: `open:folder:${item.id}`,
        group: 'open',
        icon: FolderOpen,
        title: item.name,
        hint: `${t('palette.switchFolder')} · ${item.rootPath}`,
        keywords: item.rootPath,
        perform: () => actions.openFolder(item.id),
      });
    }

    for (const tab of fileTabs) {
      list.push({
        id: `open:tab:${tab.id}`,
        group: 'open',
        icon: FileCode2,
        title: fileName(tab.relPath),
        hint: `${t('palette.openTab')} · ${tab.relPath}`,
        keywords: tab.relPath,
        perform: () => navigate(tabRoute(tab)),
      });
    }

    const seen = new Set(fileTabs.map(tab => tab.relPath));
    recent.forEach((relPath, index) => {
      if (seen.has(relPath)) return;
      seen.add(relPath);
      list.push({
        id: `open:recent:${relPath}`,
        group: 'open',
        icon: FileCode2,
        title: fileName(relPath),
        hint: `${t('palette.recentFile')} · ${relPath}`,
        keywords: relPath,
        // Most-recent-first ordering inside the group when there is no query.
        recentAt: recent.length - index,
        perform: () => navigate(`/editor/${encodeURIComponent(relPath)}`),
      });
    });

    // Up to 5,000 rows: only materialised while the palette is actually open.
    for (const file of active ? files : []) {
      if (seen.has(file.relPath)) continue;
      list.push({
        id: `open:file:${file.relPath}`,
        group: 'open',
        icon: FileCode2,
        title: fileName(file.relPath),
        hint: file.relPath,
        keywords: file.relPath,
        perform: () => navigate(`/editor/${encodeURIComponent(file.relPath)}`),
      });
    }

    /* -------------------------------------------------------------- settings */

    list.push({
      id: 'settings:open',
      group: 'settings',
      icon: Settings,
      title: t('app.settings'),
      shortcut: 'Mod+,',
      perform: () => useAppStore.getState().openSettings('general'),
    });

    for (const scope of RULE_SCOPES) {
      const label = scope === 'global'
        ? t('settings.scopeGlobal')
        : scope === 'folder'
          ? t('settings.scopeFolder', { name: folder?.name ?? '-' })
          : t('settings.scopeDuplicates');
      list.push({
        id: `settings:rules:${scope}`,
        group: 'settings',
        icon: ListTree,
        title: t('palette.scanRules', { scope: label }),
        keywords: `${t('nav.folderManager')} ${t('duplicates.rules')}`,
        disabled: scope !== 'global' && noFolder,
        disabledReason: t('palette.noFolder'),
        perform: () => useAppStore.getState().openSettings('rules', scope),
      });
    }

    for (const mode of ['light', 'dark'] as const) {
      list.push({
        id: `settings:theme:${mode}`,
        group: 'settings',
        icon: Moon,
        title: t('palette.setTheme', {
          value: mode === 'light' ? t('settings.themeLight') : t('settings.themeDark'),
        }),
        keywords: t('palette.toggleTheme'),
        disabled: theme === mode,
        perform: () => setTheme(mode),
      });
    }

    for (const option of languageOptions) {
      list.push({
        id: `settings:language:${option.code}`,
        group: 'settings',
        icon: Languages,
        title: t('palette.setLanguage', { value: option.label }),
        keywords: t('app.language'),
        disabled: language === option.code,
        perform: () => setLanguage(option.code),
      });
    }

    list.push(
      {
        id: 'settings:toggle-sidebar',
        group: 'settings',
        icon: PanelLeft,
        title: sidebarCollapsed ? t('app.expandSidebar') : t('app.collapseSidebar'),
        shortcut: 'Mod+\\',
        perform: () => useAppStore.getState().toggleSidebar(),
      },
      {
        id: 'settings:shortcuts',
        group: 'settings',
        icon: Keyboard,
        title: t('shortcuts.title'),
        shortcut: '?',
        perform: () => useAppStore.getState().setShortcutHelpOpen(true),
      },
    );

    /* ---------------------------- contextual, from whatever view is mounted */

    for (const source of sources.values()) list.push(...source());

    return list;
  }, [
    // `active` is a dependency on purpose: contextual sources register from
    // whatever view is mounted, and the list has to be rebuilt when the
    // palette opens rather than served from a memo that predates them.
    active,
    actions,
    explorerTree,
    fileTabs,
    files,
    folder,
    folderId,
    folders,
    language,
    languageOptions,
    navigate,
    recent,
    scanStatus,
    setLanguage,
    setTheme,
    sidebarCollapsed,
    t,
    theme,
  ]);
}
