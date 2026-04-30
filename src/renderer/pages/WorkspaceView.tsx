import React, { useEffect, useState } from 'react';
import type { FolderRow, GitRepoInfo } from '../../shared/api';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import { useI18n } from '../i18n';

interface Props {
  folders: FolderRow[];
  activeId: number | null;
  onAddFolder: () => Promise<void>;
  onOpenFolder: (folderId: number) => void;
  onRemoveFolder: (folder: FolderRow) => Promise<void>;
}

export default function WorkspaceView({ folders, activeId, onAddFolder, onOpenFolder, onRemoveFolder }: Props) {
  const { locale, t } = useI18n();
  const [repoInfoByFolder, setRepoInfoByFolder] = useState<Record<number, GitRepoInfo | null>>({});

  useEffect(() => {
    let cancelled = false;

    if (folders.length === 0) {
      setRepoInfoByFolder({});
      return () => { cancelled = true; };
    }

    void Promise.all(
      folders.map(async folder => [folder.id, await window.api.git.repoInfo(folder.id)] as const),
    ).then(entries => {
      if (cancelled) return;
      setRepoInfoByFolder(Object.fromEntries(entries));
    }).catch(() => {
      if (!cancelled) setRepoInfoByFolder({});
    });

    return () => { cancelled = true; };
  }, [folders]);

  function formatCommitDate(value: number | null | undefined): string {
    if (!value) return t('workspace.noCommits');
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
  }

  function formatRemoteLabel(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.host}${parsed.pathname.replace(/\.git$/i, '')}`;
    } catch {
      return url.replace(/\.git$/i, '');
    }
  }

  function closeActionMenu(target: EventTarget | null): void {
    const details = target instanceof Element ? target.closest('details') : null;
    if (details instanceof HTMLDetailsElement) details.open = false;
  }

  return (
    <div>
      <PageHeader
        title={t('workspace.title')}
        description={t('workspace.subtitle')}
        meta={t('workspace.folderCount', { count: folders.length.toLocaleString(locale) })}
        actions={<button className="primary" onClick={onAddFolder}>{t('app.addFolder')}</button>}
      />

      {folders.length === 0 ? (
        <EmptyState
          title={t('workspace.emptyTitle')}
          description={t('workspace.addFirst')}
          action={<button className="primary" onClick={onAddFolder}>{t('app.addFolder')}</button>}
        />
      ) : (
        <div className="workspace-grid">
          {folders.map(folder => (
            <article
              key={folder.id}
              className={folder.id === activeId ? 'workspace-folder-card active' : 'workspace-folder-card'}
            >
              <div className="workspace-folder-topline">
                <span className="workspace-folder-name">{folder.name}</span>
                {folder.id === activeId && <span className="status-pill">{t('common.active')}</span>}
              </div>
              <div className="workspace-folder-path">{folder.rootPath}</div>
              <div className="workspace-folder-meta-list">
                <div className="workspace-folder-meta-row">
                  <span className="workspace-folder-meta-label">{t('workspace.lastCommit')}</span>
                  <span className="workspace-folder-meta-value">{formatCommitDate(repoInfoByFolder[folder.id]?.lastCommitDate)}</span>
                </div>
                <div className="workspace-folder-meta-row">
                  <span className="workspace-folder-meta-label">{t('workspace.remoteOrigin')}</span>
                  {repoInfoByFolder[folder.id]?.remoteOriginWebUrl ? (
                    <button
                      type="button"
                      className="workspace-link-button"
                      onClick={() => void window.api.system.openExternal(repoInfoByFolder[folder.id]!.remoteOriginWebUrl!)}
                    >
                      {formatRemoteLabel(repoInfoByFolder[folder.id]!.remoteOriginWebUrl!)}
                    </button>
                  ) : (
                    <span className="workspace-folder-meta-empty">{t('workspace.noRemoteOrigin')}</span>
                  )}
                </div>
              </div>
              <div className="workspace-folder-actions">
                <button onClick={() => onOpenFolder(folder.id)}>{t('workspace.openFolder')}</button>
                <details className="workspace-folder-menu">
                  <summary aria-label={t('workspace.moreActions')}>...</summary>
                  <div className="workspace-folder-menu-popover">
                    <button
                      type="button"
                      className="danger"
                      onClick={event => {
                        closeActionMenu(event.currentTarget);
                        void onRemoveFolder(folder);
                      }}
                    >
                      {t('folderManager.remove')}
                    </button>
                  </div>
                </details>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}