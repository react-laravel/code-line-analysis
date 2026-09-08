import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EllipsisVertical, File, Folder, FolderOpen, FolderTree, FoldVertical, UnfoldVertical } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { MenuItem } from '../components/ui/_internal/types';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';
import { IconButton } from '../components/ui/icon-button';
import { DropdownMenu } from '../components/ui/menu';
import { ScrollArea } from '../components/ui/scroll-area';
import { Spinner } from '../components/ui/spinner';
import { TreeRow } from '../components/ui/tree-row';
import ScanNowButton from '../components/ScanNowButton';
import { cn } from '../lib/utils';
import {
  collectDirectoryPaths,
  flattenTree,
  parentDirectoryPath,
  pathsForLevel,
  type FlatTreeRow,
} from '../lib/tree-nodes';
import { useI18n } from '../i18n';
import { useActiveFolder, useAppStore, useRevision } from '../store/app-store';
import { EDITOR_PREFIX, editorPathOf, useTabsStore } from '../store/tabs-store';

const LEVEL_KEYS = ['tree.levelOne', 'tree.levelTwo', 'tree.levelThree'] as const;

/**
 * The file tree, promoted from the `/tree` route into permanent sidebar chrome
 * (blueprint §1.1 / §1.2). It owns exactly one `ScrollArea`, so the sticky
 * current-path line is driven by that viewport ref instead of the old
 * `treePage.closest('.content')` reach-out (`TreeView.tsx:218`).
 *
 * Expand/collapse actions sit directly in the header, with level 1·2·3 in `⋯`.
 * The native per-node context menu still calls
 * `system.showTreeNodeContextMenu` with the same five labels.
 */
export default function Explorer({ collapsed }: { collapsed: boolean }) {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const folder = useActiveFolder();
  const folderId = folder?.id ?? null;
  const revision = useRevision();

  const tree = useAppStore(state => state.explorerTree);
  const setExplorerTree = useAppStore(state => state.setExplorerTree);
  const toggleSidebar = useAppStore(state => state.toggleSidebar);
  const expandedByFolder = useAppStore(state => state.expandedTreePathsByFolder);
  const toggleTreePath = useAppStore(state => state.toggleTreePath);
  const replaceTreePaths = useAppStore(state => state.replaceTreePaths);

  const openFile = useTabsStore(state => state.openFile);
  const activeRelPath = editorPathOf(location.pathname);

  const [loading, setLoading] = useState(false);
  const [currentDirPath, setCurrentDirPath] = useState('');
  const [focusIndex, setFocusIndex] = useState(0);

  const listRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const typeahead = useRef<{ query: string; at: number }>({ query: '', at: 0 });

  /* ------------------------------------------------------------------ data */

  useEffect(() => {
    if (folderId == null) {
      setExplorerTree(null);
      setLoading(false);
      setCurrentDirPath('');
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    window.api.stats.tree(folderId)
      .then(next => {
        if (cancelled) return;
        setExplorerTree(next);
        setCurrentDirPath('');
      })
      .catch(() => {
        if (!cancelled) setExplorerTree(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [folderId, revision, setExplorerTree]);

  const expandedPathSet = useMemo(() => {
    const next = new Set(folderId == null ? [] : expandedByFolder[folderId] ?? ['']);
    next.add('');
    return next;
  }, [expandedByFolder, folderId]);

  const rows: FlatTreeRow[] = useMemo(
    () => (tree ? flattenTree(tree, expandedPathSet) : []),
    [expandedPathSet, tree],
  );

  const directories = useMemo(
    () => (tree ? collectDirectoryPaths(tree) : { allPaths: [], maxDepth: 0 }),
    [tree],
  );

  const rootName = folder?.name || folder?.rootPath || '/';

  const breadcrumbs = useMemo(() => {
    const segments = currentDirPath.split('/').filter(Boolean);
    return [rootName, ...segments];
  }, [currentDirPath, rootName]);

  /* ------------------------------------------------- current directory line */

  useEffect(() => {
    const viewport = viewportRef.current;
    const list = listRef.current;
    if (!viewport || !list || rows.length === 0) return undefined;

    let rafId: number | null = null;

    function update(): void {
      rafId = null;
      if (!viewport || !list) return;
      const nodes = Array.from(list.querySelectorAll<HTMLElement>('[role="treeitem"]'));
      if (nodes.length === 0) return;
      const threshold = viewport.getBoundingClientRect().top;
      const index = nodes.findIndex(node => node.getBoundingClientRect().bottom > threshold);
      const row = rows[index < 0 ? rows.length - 1 : index];
      if (!row) return;
      const activePath = row.node.isDir ? row.node.path : parentDirectoryPath(row.node.path);
      setCurrentDirPath(previous => (previous === activePath ? previous : activePath));
    }

    function requestUpdate(): void {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(update);
    }

    requestUpdate();
    viewport.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);

    return () => {
      viewport.removeEventListener('scroll', requestUpdate);
      window.removeEventListener('resize', requestUpdate);
      if (rafId != null) window.cancelAnimationFrame(rafId);
    };
  }, [rows]);

  /* --------------------------------------------------------------- actions */

  const activate = useCallback((row: FlatTreeRow) => {
    if (folderId == null) return;
    if (row.node.isDir) {
      if (row.node.path !== '') {
        toggleTreePath(folderId, row.node.path, !expandedPathSet.has(row.node.path));
      }
      return;
    }
    // Opening a file is a tab now (blueprint §3.4) — the shell's tab effect
    // mirrors the route back into the store, so navigating is enough.
    openFile(folderId, row.node.path);
    navigate(`${EDITOR_PREFIX}${encodeURIComponent(row.node.path)}`);
  }, [expandedPathSet, folderId, navigate, openFile, toggleTreePath]);

  function focusRow(index: number): void {
    const nodes = listRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]');
    const node = nodes?.[index];
    if (!node) return;
    setFocusIndex(index);
    node.focus();
    node.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Container-level ↑↓ / Home / End / type-ahead, plus the two arrow cases
   * `TreeRow` deliberately leaves alone: `←` on a leaf or a collapsed row moves
   * to the parent, `→` on an already-expanded row moves to the first child.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.defaultPrevented || rows.length === 0) return;
    const current = Math.min(focusIndex, rows.length - 1);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusRow(Math.min(current + 1, rows.length - 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusRow(Math.max(current - 1, 0));
        return;
      case 'Home':
        event.preventDefault();
        focusRow(0);
        return;
      case 'End':
        event.preventDefault();
        focusRow(rows.length - 1);
        return;
      case 'ArrowLeft': {
        event.preventDefault();
        const parent = rows[current]?.parentIndex ?? -1;
        if (parent >= 0) focusRow(parent);
        return;
      }
      case 'ArrowRight': {
        const row = rows[current];
        if (!row?.node.isDir) return;
        event.preventDefault();
        if (rows[current + 1]?.parentIndex === current) focusRow(current + 1);
        return;
      }
      default:
        break;
    }

    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    const now = Date.now();
    const query = (now - typeahead.current.at < 700 ? typeahead.current.query : '') + event.key.toLowerCase();
    typeahead.current = { query, at: now };
    const match = rows.findIndex((row, index) =>
      index > (query.length > 1 ? current - 1 : current)
      && (row.node.name || rootName).toLowerCase().startsWith(query));
    const wrapped = match >= 0
      ? match
      : rows.findIndex(row => (row.node.name || rootName).toLowerCase().startsWith(query));
    if (wrapped >= 0) {
      event.preventDefault();
      focusRow(wrapped);
    }
  }

  function onContextMenu(event: React.MouseEvent<HTMLDivElement>): void {
    if (folderId == null) return;
    const target = event.target instanceof Element ? event.target.closest('[role="treeitem"]') : null;
    if (!target) return;
    const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []);
    const row = rows[nodes.indexOf(target as HTMLElement)];
    if (!row) return;

    event.preventDefault();
    // Unchanged Rust call — the same five labels the tree page used.
    void window.api.system.showTreeNodeContextMenu({
      folderId,
      relPath: row.node.path,
      displayName: row.node.path ? row.node.name : rootName,
      x: event.clientX,
      y: event.clientY,
      labels: {
        copyName: t('tree.menu.copyName'),
        copyRelativePath: t('tree.menu.copyRelativePath'),
        copyAbsolutePath: t('tree.menu.copyAbsolutePath'),
        openPath: t('tree.menu.openPath'),
        revealInFinder: t('tree.menu.revealInFinder'),
      },
    });
  }

  const overflow: MenuItem[] = useMemo(() => {
    if (folderId == null) return [];
    const levels = [1, 2, 3].filter(level => directories.maxDepth >= level);
    return levels.map<MenuItem>(level => ({
      id: `level-${level}`,
      label: t(LEVEL_KEYS[level - 1]),
      onSelect: () => {
        if (tree) replaceTreePaths(folderId, pathsForLevel(tree, level));
      },
    }));
  }, [directories.maxDepth, folderId, replaceTreePaths, t, tree]);

  /* ---------------------------------------------------------------- render */

  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-col items-center border-t border-border px-1 py-2">
        <IconButton
          icon={FolderTree}
          label={t('explorer.show')}
          size="sm"
          variant="ghost"
          tooltipSide="right"
          onClick={toggleSidebar}
        />
      </div>
    );
  }

  return (
    <section
      aria-label={t('explorer.title')}
      className="flex min-h-0 flex-1 flex-col border-t border-border"
    >
      <header className="flex h-control-sm shrink-0 items-center gap-1 pr-1 pl-2">
        <h2 className="min-w-0 flex-1 truncate text-2xs font-medium tracking-wide text-fg-subtle uppercase">
          {t('explorer.title')}
        </h2>
        {folderId != null ? (
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              icon={UnfoldVertical}
              label={t('tree.expandAll')}
              size="xs"
              variant="ghost"
              disabled={directories.allPaths.length === 0}
              onClick={() => replaceTreePaths(folderId, directories.allPaths)}
            />
            <IconButton
              icon={FoldVertical}
              label={t('tree.collapseAll')}
              size="xs"
              variant="ghost"
              disabled={directories.allPaths.length === 0}
              onClick={() => replaceTreePaths(folderId, [])}
            />
            {overflow.length > 0 ? (
              <DropdownMenu
                items={overflow}
                align="end"
                trigger={<IconButton icon={EllipsisVertical} label={t('explorer.actions')} size="xs" variant="ghost" />}
              />
            ) : null}
          </div>
        ) : null}
      </header>

      {tree && rows.length > 0 ? (
        <div
          title={breadcrumbs.join('/')}
          aria-label={t('tree.currentPath')}
          className="flex shrink-0 items-center gap-1 overflow-hidden px-2 pb-1 font-mono text-2xs whitespace-nowrap text-fg-muted"
        >
          {breadcrumbs.map((segment, index) => (
            <span key={`${segment}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <span className="shrink-0 text-fg-subtle">/</span> : null}
              <span className={cn('truncate', index === breadcrumbs.length - 1 && 'text-fg')}>{segment}</span>
            </span>
          ))}
        </div>
      ) : null}

      <ScrollArea viewportRef={viewportRef} className="pb-2">
        {folder == null ? (
          <EmptyState
            size="sm"
            variant="no-selection"
            title={t('app.noFolderSelected')}
            action={(
              <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
                {t('nav.workspace')}
              </Button>
            )}
          />
        ) : loading && !tree ? (
          <div className="flex items-center justify-center py-6">
            <Spinner size="sm" label={t('tree.loading')} />
          </div>
        ) : !tree ? (
          <EmptyState
            size="sm"
            title={t('common.noData')}
            description={t('tree.noData')}
            action={<ScanNowButton folderId={folder.id} disabled={!folder.isAvailable} />}
          />
        ) : (
          <div
            ref={listRef}
            role="tree"
            data-explorer-tree
            aria-label={t('explorer.tree')}
            aria-busy={loading || undefined}
            onKeyDown={onKeyDown}
            onContextMenu={onContextMenu}
            onFocusCapture={event => {
              const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []);
              const index = nodes.indexOf(event.target as HTMLElement);
              if (index >= 0) setFocusIndex(index);
            }}
          >
            {rows.map((row, index) => {
              const isRoot = row.node.path === '';
              const expanded = row.node.isDir && expandedPathSet.has(row.node.path);
              const name = row.node.name || rootName;
              // A 260px sidebar cannot hold "12,480 Lines · 320 Files", so the
              // row shows the figures and the full labelled counts live in the
              // row title alongside the path (blueprint §7 risk 2).
              const counts = `${row.node.total.toLocaleString(locale)} ${t('common.lines')}`
                + (row.node.isDir ? ` · ${row.node.files.toLocaleString(locale)} ${t('common.files')}` : '');
              return (
                <TreeRow
                  key={row.node.path || '/'}
                  depth={row.depth}
                  indentDepth={Math.max(0, row.depth - 1)}
                  label={<span className="font-mono text-xs">{name}</span>}
                  title={`${row.node.path || rootName} — ${counts}`}
                  icon={row.node.isDir ? (expanded ? FolderOpen : Folder) : File}
                  iconTone={row.node.isDir ? 'accent' : 'neutral'}
                  expandable={row.node.isDir}
                  hideToggle={isRoot}
                  expanded={expanded}
                  onToggle={() => {
                    if (folderId != null && !isRoot) toggleTreePath(folderId, row.node.path, !expanded);
                  }}
                  selected={!row.node.isDir && row.node.path === activeRelPath}
                  tabIndex={index === Math.min(focusIndex, rows.length - 1) ? 0 : -1}
                  meta={(
                    <span aria-label={counts}>
                      {row.node.total.toLocaleString(locale)}
                      {row.node.isDir ? ` · ${row.node.files.toLocaleString(locale)}` : ''}
                    </span>
                  )}
                  onActivate={() => activate(row)}
                />
              );
            })}
          </div>
        )}
      </ScrollArea>
    </section>
  );
}
