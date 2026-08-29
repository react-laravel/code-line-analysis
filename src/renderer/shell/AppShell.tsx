import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CircleAlert, FileCode2, FolderOpen } from 'lucide-react';
import type { MenuItem } from '../components/ui/_internal/types';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ui/dialog';
import { ProgressBar } from '../components/ui/progress';
import { ScrollArea } from '../components/ui/scroll-area';
import { SplitPane } from '../components/ui/split-pane';
import { TabStrip, type DocumentTab } from '../components/ui/tab-strip';
import { Toaster, toast } from '../components/ui/toast';
import { useI18n } from '../i18n';
import { useActiveFolder, useAppStore } from '../store/app-store';
import { useScanStore } from '../store/scan-store';
import {
  contentLayoutOf,
  editorPathOf,
  isTabDirty,
  routeAfterClosing,
  tabId,
  tabRoute,
  tabTitle,
  useFileTabs,
  useTabsStore,
} from '../store/tabs-store';
import { useFolderActions } from '../hooks/useFolderActions';
import { useShortcuts } from '../hooks/useShortcuts';
import { NAV_ITEMS } from './nav-items';
import ContentRegion from './ContentRegion';
import Explorer from './Explorer';
import SideNav from './SideNav';
import StatusBar from './StatusBar';
import TitleBar from './TitleBar';
import CommandPaletteHost from './CommandPaletteHost';
import SettingsDialog from '../views/SettingsDialog';

/**
 * The IA spine (blueprint §2.1): titlebar · sidebar · tabstrip · content ·
 * statusbar. `App.tsx` keeps only routing; every piece of shell state now lives
 * in `store/`.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const folder = useActiveFolder();
  const folderId = folder?.id ?? null;

  const activeFolderId = useAppStore(state => state.activeFolderId);
  const folders = useAppStore(state => state.folders);
  const foldersLoaded = useAppStore(state => state.foldersLoaded);
  const revision = useAppStore(state => state.revision);
  const sidebarCollapsed = useAppStore(state => state.sidebarCollapsed);
  const toggleSidebar = useAppStore(state => state.toggleSidebar);
  const autoScanOnOpen = useAppStore(state => state.autoScanOnOpen);
  const pendingRemoveFolder = useAppStore(state => state.pendingRemoveFolder);
  const setPendingRemoveFolder = useAppStore(state => state.setPendingRemoveFolder);
  const lastViewPathByFolder = useAppStore(state => state.lastViewPathByFolder);

  const scanStatus = useScanStore(state => state.status);
  const scanProgress = useScanStore(state => state.progress);
  const scanError = useScanStore(state => state.error);
  const outcomeToken = useScanStore(state => state.outcomeToken);

  const fileTabs = useFileTabs(folderId);
  const openFile = useTabsStore(state => state.openFile);
  const closeTabs = useTabsStore(state => state.closeTabs);
  const requestClose = useTabsStore(state => state.requestClose);
  const clearPendingClose = useTabsStore(state => state.clearPendingClose);
  const pendingClose = useTabsStore(state => state.pendingClose);
  const reorder = useTabsStore(state => state.reorder);

  const actions = useFolderActions();
  useShortcuts();

  const editorRelPath = editorPathOf(location.pathname);
  const contentLayout = contentLayoutOf(location.pathname);
  const viewPath = folderId != null
    ? lastViewPathByFolder[folderId] ?? '/overview'
    : '/';

  /* -------------------------------------------------------------- bootstrap */

  useEffect(() => {
    void useAppStore.getState().refreshFolders();
  }, []);

  useEffect(() => useScanStore.getState().listen(), []);

  // The 5-second folder poll (`App.tsx:101-105`) is replaced by
  // refresh-on-focus plus explicit invalidation after add/remove/relocate.
  useEffect(() => {
    function onFocus(): void {
      void useAppStore.getState().refreshFolders();
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const booted = useRef(false);
  useEffect(() => {
    if (!foldersLoaded || booted.current) return;
    booted.current = true;
    if (location.pathname !== '/') return;
    if (activeFolderId == null) return;
    navigate(lastViewPathByFolder[activeFolderId] ?? '/overview', { replace: true });
  }, [activeFolderId, foldersLoaded, lastViewPathByFolder, location.pathname, navigate]);

  // With no folders at all the content region shows the Workspace view's
  // `first-run` EmptyState — the app's genuine cold-start screen, whatever
  // route was persisted (blueprint §2.1 / §3.1). It also catches removing the
  // last folder while sitting on a view.
  useEffect(() => {
    if (!foldersLoaded || folders.length > 0 || location.pathname === '/') return;
    navigate('/', { replace: true });
  }, [folders.length, foldersLoaded, location.pathname, navigate]);

  /* ------------------------------------------------------- folder-scoped data */

  useEffect(() => {
    let ignore = false;
    if (activeFolderId == null) {
      useAppStore.getState().setSummary(null);
      return () => {
        ignore = true;
      };
    }

    void window.api.stats.summary(activeFolderId)
      .then(summary => {
        if (!ignore) useAppStore.getState().setSummary(summary);
      })
      .catch(() => {
        if (!ignore) useAppStore.getState().setSummary(null);
      });

    return () => {
      ignore = true;
    };
  }, [activeFolderId, revision]);

  useEffect(() => {
    let ignore = false;
    if (activeFolderId == null) return () => {
      ignore = true;
    };

    void window.api.stats.laravelSchema(activeFolderId)
      .then(schema => {
        if (!ignore) useAppStore.getState().setLaravel(activeFolderId, schema.isLaravel);
      })
      .catch(() => {
        if (!ignore) useAppStore.getState().setLaravel(activeFolderId, false);
      });

    return () => {
      ignore = true;
    };
  }, [activeFolderId, revision]);

  // Auto-scan is opt-in now (blueprint §3.1); Rescan / ⌘R is the trigger.
  const autoScanned = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!autoScanOnOpen || activeFolderId == null) return;
    if (!folders.find(item => item.id === activeFolderId)?.isAvailable) return;
    if (autoScanned.current.has(activeFolderId)) return;
    autoScanned.current.add(activeFolderId);
    void useScanStore.getState().run(activeFolderId, {
      detectDuplicates: useAppStore.getState().detectDuplicatesOnScan,
    });
  }, [activeFolderId, autoScanOnOpen, folders]);

  /* ------------------------------------------------------------------ tabs */

  useEffect(() => {
    if (editorRelPath || folderId == null) return;
    useAppStore.getState().rememberViewPath(folderId, location.pathname + location.search);
  }, [editorRelPath, folderId, location.pathname, location.search]);

  useEffect(() => {
    if (!editorRelPath || folderId == null) return;
    openFile(folderId, editorRelPath, location.search);
  }, [editorRelPath, folderId, location.search, openFile]);

  const viewLabel = useMemo(() => {
    const match = NAV_ITEMS.find(item =>
      item.end ? viewPath === item.to : viewPath.startsWith(item.to),
    );
    return match ? t(match.labelKey) : t('nav.workspace');
  }, [t, viewPath]);

  const activeTabId = editorRelPath && folderId != null ? tabId(folderId, editorRelPath) : 'view';

  const tabs: DocumentTab[] = useMemo(() => [
    { id: 'view', title: viewLabel, icon: FolderOpen, closable: false },
    ...fileTabs.map(tab => ({
      id: tab.id,
      title: tabTitle(tab),
      icon: FileCode2,
      dirty: isTabDirty(tab),
    })),
  ], [fileTabs, viewLabel]);

  const selectTab = useCallback((id: string) => {
    if (id === 'view') {
      navigate(viewPath);
      return;
    }
    const tab = fileTabs.find(item => item.id === id);
    if (tab) navigate(tabRoute(tab));
  }, [fileTabs, navigate, viewPath]);

  /**
   * Every close — the tab's `×`, its context menu, the editor's `⋯`, `⌘W` —
   * goes through `requestClose`, which parks the request in the store. The
   * shell is the single place that resolves it: it decides where to land and,
   * when a target has unsaved work, shows the `ConfirmDialog` first.
   */
  const performClose = useCallback((ids: string[]) => {
    const target = routeAfterClosing(fileTabs, ids, activeTabId, viewPath);
    closeTabs(ids);
    clearPendingClose();
    if (target) navigate(target);
  }, [activeTabId, clearPendingClose, closeTabs, fileTabs, navigate, viewPath]);

  useEffect(() => {
    if (!pendingClose || pendingClose.confirm) return;
    performClose(pendingClose.ids);
  }, [pendingClose, performClose]);

  const tabMenu = useCallback((id: string): MenuItem[] => {
    if (id === 'view') {
      // The view tab is pinned, so its only verb is "close every file tab".
      return [
        {
          id: 'close-files',
          label: t('tabs.closeOthers'),
          disabled: fileTabs.length === 0,
          onSelect: () => requestClose(fileTabs.map(tab => tab.id)),
        },
      ];
    }
    const tab = fileTabs.find(item => item.id === id);
    const index = fileTabs.findIndex(item => item.id === id);
    return [
      { id: 'close', label: t('tabs.close'), onSelect: () => requestClose([id]) },
      {
        id: 'close-others',
        label: t('tabs.closeOthers'),
        disabled: fileTabs.length < 2,
        onSelect: () => requestClose(fileTabs.filter(item => item.id !== id).map(item => item.id)),
      },
      {
        id: 'close-right',
        label: t('tabs.closeToRight'),
        disabled: index < 0 || index === fileTabs.length - 1,
        onSelect: () => requestClose(fileTabs.slice(index + 1).map(item => item.id)),
      },
      { kind: 'separator', id: 'sep' },
      {
        id: 'copy-path',
        label: t('tree.menu.copyRelativePath'),
        disabled: !tab,
        onSelect: () => {
          if (tab) void navigator.clipboard?.writeText(tab.relPath).catch(() => undefined);
        },
      },
    ];
  }, [fileTabs, requestClose, t]);

  /* --------------------------------------------------------------- outcomes */

  const lastOutcome = useRef(0);
  useEffect(() => {
    if (outcomeToken === 0 || outcomeToken === lastOutcome.current) return;
    lastOutcome.current = outcomeToken;
    const { status, error } = useScanStore.getState();
    if (status === 'error') {
      toast.show({ tone: 'danger', title: t('app.scanFailed'), details: error ?? undefined });
    } else if (status === 'cancelled') {
      toast.show({ tone: 'neutral', title: t('app.scanCancelled') });
    }
  }, [outcomeToken, scanError, t]);

  /* ---------------------------------------------------------------- render */

  const progressValue = scanProgress?.total
    ? scanProgress.done / scanProgress.total
    : undefined;
  // `cancelled` removes the bar; `error` keeps a solid danger line
  // (DESIGN-SYSTEM §7.1).
  const showProgressLine = scanStatus !== 'idle' && scanStatus !== 'cancelled';

  const contentScrollKey = folderId != null
    ? `content:${folderId}:${location.pathname}${location.search}`
    : undefined;

  return (
    <div className="flex h-screen min-h-0 flex-col bg-canvas text-fg">
      <TitleBar />

      <SplitPane
        direction="horizontal"
        storageKey="cla.sidebar"
        defaultRatio={0.26}
        min={180}
        max={420}
        collapsible="first"
        collapsed={sidebarCollapsed}
        onCollapsedChange={toggleSidebar}
        collapsedSize={44}
        separatorLabel={t('app.resizeSidebar')}
        className="min-h-0 flex-1"
      >
        {/* SplitPane draws the divider itself — no border-r here. */}
        {/* VIEWS on top, the Explorer filling the rest — each with its own
            scroll region (blueprint §2.1). */}
        <aside className="flex min-h-0 flex-1 flex-col bg-surface">
          {/* With Overview · Code · Architecture collapsed to one entry each the
              nav is five short rows, so it takes its natural height again and
              the Explorer gets the rest of the sidebar (blueprint §1.1). */}
          <ScrollArea className={sidebarCollapsed ? undefined : 'flex-none'}>
            <SideNav collapsed={sidebarCollapsed} />
          </ScrollArea>
          <Explorer collapsed={sidebarCollapsed} />
        </aside>

        <div className="flex min-h-0 flex-1 flex-col bg-canvas">
          <TabStrip
            aria-label={t('tabs.label')}
            tabs={tabs}
            activeId={activeTabId}
            onSelect={selectTab}
            onClose={id => requestClose([id])}
            onReorder={(from, to) => {
              // Index 0 is the pinned view tab; file tabs start at 1.
              if (folderId == null || from === 0 || to === 0) return;
              reorder(folderId, from - 1, to - 1);
            }}
            onContextMenu={tabMenu}
            closeLabel={t('tabs.close')}
          />

          {folder && !folder.isAvailable ? (
            <div
              role="alert"
              className="flex shrink-0 items-center gap-2 border-b border-border bg-danger-quiet px-3 py-1.5 text-xs text-danger-text"
            >
              <CircleAlert aria-hidden strokeWidth={1.75} size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {t('workspace.locationMissingHelp', { path: folder.rootPath })}
              </span>
              <Button
                size="xs"
                variant="danger-ghost"
                icon={FolderOpen}
                onClick={() => void actions.relocateFolder(folder)}
              >
                {t('workspace.relocate')}
              </Button>
            </div>
          ) : null}

          <ContentRegion
            layout={contentLayout}
            restoreKey={contentScrollKey}
            progress={showProgressLine ? (
              <ProgressBar
                variant="line"
                status={scanStatus}
                value={progressValue}
                className="absolute inset-x-0 top-0 z-[var(--ds-z-chrome)]"
              />
            ) : null}
          >
            {children}
          </ContentRegion>
        </div>
      </SplitPane>

      <StatusBar />

      <SettingsDialog />
      <CommandPaletteHost />
      <Toaster />

      {/* Closing a tab with unsaved work (blueprint §2.5) — the subject names
          the files, in mono, and Cancel takes focus on open. */}
      <ConfirmDialog
        open={pendingClose?.confirm === true}
        onOpenChange={open => {
          if (!open) clearPendingClose();
        }}
        tone="danger"
        title={t('editor.discardTitle')}
        subject={pendingClose?.dirtyTitles.join(', ')}
        consequence={t('editor.discardConsequence')}
        confirmLabel={t('editor.discard')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          if (pendingClose) performClose(pendingClose.ids);
        }}
      />

      <ConfirmDialog
        open={pendingRemoveFolder != null}
        onOpenChange={open => {
          if (!open) setPendingRemoveFolder(null);
        }}
        tone="danger"
        title={t('folderManager.remove')}
        subject={pendingRemoveFolder?.name}
        consequence={t('folderManager.removeConsequence')}
        confirmLabel={t('folderManager.remove')}
        cancelLabel={t('common.cancel')}
        onConfirm={async () => {
          if (pendingRemoveFolder) await actions.removeFolder(pendingRemoveFolder);
          setPendingRemoveFolder(null);
        }}
      />
    </div>
  );
}
