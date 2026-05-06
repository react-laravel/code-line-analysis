import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FolderRow, DirNode } from '../../shared/api';
import PageHeader from '../components/PageHeader';
import { useI18n } from '../i18n';

interface Props {
  folder: FolderRow | null;
  scanRevision: number;
  expandedPaths: string[];
  onTogglePath: (folderId: number, path: string, open: boolean) => void;
  onReplaceExpandedPaths: (folderId: number, paths: string[]) => void;
}

interface NodeProps {
  folderId: number;
  rootName: string;
  node: DirNode;
  depth: number;
  expandedPaths: Set<string>;
  onOpen: (path: string) => void;
  onTogglePath: (folderId: number, path: string, open: boolean) => void;
}

function Node({ folderId, rootName, node, depth, expandedPaths, onOpen, onTogglePath }: NodeProps) {
  const open = expandedPaths.has(node.path);
  const { locale, t } = useI18n();
  const displayName = node.name || rootName || '/';

  function activateNode() {
    if (node.isDir) onTogglePath(folderId, node.path, !open);
    else onOpen(node.path);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activateNode();
      return;
    }

    if (!node.isDir) return;
    if (event.key === 'ArrowRight' && !open) {
      event.preventDefault();
      onTogglePath(folderId, node.path, true);
    }
    if (event.key === 'ArrowLeft' && open) {
      event.preventDefault();
      onTogglePath(folderId, node.path, false);
    }
  }

  function handleContextMenu(event: React.MouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    void window.api.system.showTreeNodeContextMenu({
      folderId,
      relPath: node.path,
      displayName: node.path ? node.name : rootName,
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

  return (
    <div className="tree-node">
      <div
        className="row"
        role="button"
        tabIndex={0}
        aria-expanded={node.isDir ? open : undefined}
        data-tree-dir={node.isDir ? '1' : '0'}
        data-tree-path={node.path}
        style={{ paddingLeft: depth * 16 }}
        onClick={activateNode}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
      >
        <span className="name">{node.isDir ? (open ? '▼ ' : '▶ ') : '  '}{displayName}</span>
        <span className="total">{node.total.toLocaleString(locale)} {t('common.lines')}{node.isDir ? ` · ${node.files.toLocaleString(locale)} ${t('common.files')}` : ''}</span>
      </div>
      {node.isDir && open && node.children?.map((c, i) => (
        <Node
          key={c.path}
          folderId={folderId}
          rootName={rootName}
          node={c}
          depth={depth + 1}
          expandedPaths={expandedPaths}
          onOpen={onOpen}
          onTogglePath={onTogglePath}
        />
      ))}
    </div>
  );
}

function collectDirectoryPaths(node: DirNode): { allPaths: string[]; maxDepth: number } {
  const allPaths: string[] = [];
  let maxDepth = 0;

  function visit(current: DirNode, depth: number): void {
    if (!current.isDir) return;
    if (current.path !== '') {
      allPaths.push(current.path);
      maxDepth = Math.max(maxDepth, depth);
    }
    current.children?.forEach(child => {
      if (child.isDir) visit(child, depth + 1);
    });
  }

  visit(node, 0);
  return { allPaths, maxDepth };
}

function pathsForLevel(node: DirNode, targetDepth: number): string[] {
  const paths: string[] = [];

  function visit(current: DirNode, depth: number): void {
    if (!current.isDir) return;
    if (current.path !== '' && depth <= targetDepth) paths.push(current.path);
    if (depth >= targetDepth) return;
    current.children?.forEach(child => {
      if (child.isDir) visit(child, depth + 1);
    });
  }

  visit(node, 0);
  return paths;
}

function parentDirectoryPath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 1) return '';
  return segments.slice(0, -1).join('/');
}

export default function TreeView({ folder, scanRevision, expandedPaths, onTogglePath, onReplaceExpandedPaths }: Props) {
  const [tree, setTree] = useState<DirNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentDirPath, setCurrentDirPath] = useState('');
  const treePageRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const { t } = useI18n();

  const expandedPathSet = useMemo(() => {
    const next = new Set(expandedPaths);
    next.add('');
    return next;
  }, [expandedPaths]);

  const treeDirectories = useMemo(() => tree ? collectDirectoryPaths(tree) : { allPaths: [], maxDepth: 0 }, [tree]);
  const visibleLevels = useMemo(
    () => [1, 2, 3].filter(level => treeDirectories.maxDepth >= level),
    [treeDirectories.maxDepth],
  );
  const allDirectoriesExpanded = useMemo(
    () => treeDirectories.allPaths.length > 0 && treeDirectories.allPaths.every(path => expandedPathSet.has(path)),
    [expandedPathSet, treeDirectories.allPaths],
  );
  const currentBreadcrumbs = useMemo(() => {
    const rootLabel = folder?.name || folder?.rootPath || '/';
    const segments = currentDirPath.split('/').filter(Boolean);
    return [rootLabel, ...segments];
  }, [currentDirPath, folder?.name, folder?.rootPath]);

  useEffect(() => {
    const folderId = folder?.id;
    if (folderId == null) {
      setTree(null);
      setLoading(false);
      setCurrentDirPath('');
      return;
    }

    let cancelled = false;
    setTree(null);
    setLoading(true);

    window.api.stats.tree(folderId)
      .then(nextTree => {
        if (!cancelled) {
          setTree(nextTree);
          setCurrentDirPath('');
        }
      })
      .catch(() => {
        if (!cancelled) setTree(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [folder?.id, scanRevision]);

  useEffect(() => {
    const treePage = treePageRef.current;
    if (!treePage || !tree) return undefined;

    const scrollContainer = treePage.closest('.content');
    if (!(scrollContainer instanceof HTMLElement)) return undefined;

    let rafId: number | null = null;

    function updateCurrentDirPath(): void {
      rafId = null;

      const rows = Array.from(treePage.querySelectorAll<HTMLElement>('.tree-node .row[data-tree-path]'));
      if (rows.length === 0) {
        setCurrentDirPath('');
        return;
      }

      const stickyCurrentPath = treePage.querySelector<HTMLElement>('.tree-current-path');
      const threshold = stickyCurrentPath?.getBoundingClientRect().bottom ?? scrollContainer.getBoundingClientRect().top;
      const firstVisibleRow = rows.find(row => row.getBoundingClientRect().bottom > threshold) ?? rows[rows.length - 1];
      const rowPath = firstVisibleRow?.dataset.treePath ?? '';
      const activePath = firstVisibleRow?.dataset.treeDir === '1' ? rowPath : parentDirectoryPath(rowPath);

      setCurrentDirPath(previous => previous === activePath ? previous : activePath);
    }

    function requestUpdate(): void {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(updateCurrentDirPath);
    }

    requestUpdate();
    scrollContainer.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);

    return () => {
      scrollContainer.removeEventListener('scroll', requestUpdate);
      window.removeEventListener('resize', requestUpdate);
      if (rafId != null) window.cancelAnimationFrame(rafId);
    };
  }, [expandedPaths, tree]);

  function replaceExpandedPaths(paths: string[]): void {
    if (!folder) return;
    onReplaceExpandedPaths(folder.id, paths);
  }

  function handleExpandAll(): void {
    replaceExpandedPaths(allDirectoriesExpanded ? [] : treeDirectories.allPaths);
  }

  function handleExpandLevel(level: number): void {
    if (!tree) return;
    replaceExpandedPaths(pathsForLevel(tree, level));
  }

  if (!folder) return <div className="empty">{t('common.selectFolder')}</div>;
  if (loading) return <div className="empty">{t('tree.loading')}</div>;
  if (!tree) return <div className="empty">{t('tree.noData')}</div>;

  return (
    <div ref={treePageRef} className="tree-page">
      <PageHeader
        title={t('tree.title')}
        description={t('tree.subtitle', { count: treeDirectories.maxDepth.toLocaleString() })}
      />
      <section className="tree-current-path" aria-label={t('tree.currentPath')}>
        <span className="tree-current-path-label">{t('tree.currentPath')}</span>
        <div className="tree-current-path-breadcrumbs">
          {currentBreadcrumbs.map((segment, index) => (
            <React.Fragment key={`${segment}-${index}`}>
              {index > 0 ? <span className="tree-current-path-separator">/</span> : null}
              <span className={index === currentBreadcrumbs.length - 1 ? 'tree-current-path-segment active' : 'tree-current-path-segment'}>{segment}</span>
            </React.Fragment>
          ))}
        </div>
      </section>
      <Node
        folderId={folder.id}
        rootName={folder.name || folder.rootPath || '/'}
        node={tree}
        depth={0}
        expandedPaths={expandedPathSet}
        onOpen={p => navigate(`/editor/${encodeURIComponent(p)}`)}
        onTogglePath={onTogglePath}
      />
      <section className="tree-bottom-actions" aria-label={t('tree.quickActions')}>
        <button type="button" onClick={handleExpandAll} disabled={treeDirectories.allPaths.length === 0}>
          {allDirectoriesExpanded ? t('tree.collapseAll') : t('tree.expandAll')}
        </button>
        {visibleLevels.map(level => (
          <button
            key={level}
            type="button"
            onClick={() => handleExpandLevel(level)}
          >
            {[
              t('tree.levelOne'),
              t('tree.levelTwo'),
              t('tree.levelThree'),
            ][level - 1]}
          </button>
        ))}
      </section>
    </div>
  );
}
