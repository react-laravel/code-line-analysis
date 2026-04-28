import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FolderRow, DirNode } from '../../shared/api';
import { useI18n } from '../i18n';

interface Props {
  folder: FolderRow | null;
  scanRevision: number;
  expandedPaths: string[];
  onTogglePath: (folderId: number, path: string, open: boolean) => void;
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
        style={{ paddingLeft: depth * 16 }}
        onClick={() => node.isDir ? onTogglePath(folderId, node.path, !open) : onOpen(node.path)}
        onContextMenu={handleContextMenu}
      >
        <span className="name">{node.isDir ? (open ? '▼ ' : '▶ ') : '  '}{node.name || '/'}</span>
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

export default function TreeView({ folder, scanRevision, expandedPaths, onTogglePath }: Props) {
  const [tree, setTree] = useState<DirNode | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { t } = useI18n();

  const expandedPathSet = useMemo(() => {
    const next = new Set(expandedPaths);
    next.add('');
    return next;
  }, [expandedPaths]);

  useEffect(() => {
    const folderId = folder?.id;
    if (folderId == null) {
      setTree(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setTree(null);
    setLoading(true);

    window.api.stats.tree(folderId)
      .then(nextTree => {
        if (!cancelled) setTree(nextTree);
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

  if (!folder) return <div className="empty">{t('common.selectFolder')}</div>;
  if (loading) return <div className="empty">{t('tree.loading')}</div>;
  if (!tree) return <div className="empty">{t('tree.noData')}</div>;

  return (
    <div>
      <h1>{t('tree.title')}</h1>
      <Node
        folderId={folder.id}
        rootName={folder.name || folder.rootPath || '/'}
        node={tree}
        depth={0}
        expandedPaths={expandedPathSet}
        onOpen={p => navigate(`/editor/${encodeURIComponent(p)}`)}
        onTogglePath={onTogglePath}
      />
    </div>
  );
}
