import React, { useEffect, useMemo, useState } from 'react';
import type { FolderRow, GitRepoInfo } from '../../shared/api';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import { useI18n } from '../i18n';

interface Props {
  folders: FolderRow[];
  activeId: number | null;
  onAddFolder: () => Promise<void>;
  onAddGitRepositories: () => Promise<void>;
  onImportDroppedFolder?: (dataTransfer: DataTransfer) => Promise<void>;
  onOpenFolder: (folderId: number) => void;
  onRemoveFolder: (folder: FolderRow) => Promise<void>;
  webMode: boolean;
}

function AddFolderActions({
  onAddFolder,
  onAddGitRepositories,
  webMode,
}: {
  onAddFolder: () => Promise<void>;
  onAddGitRepositories: () => Promise<void>;
  webMode: boolean;
}) {
  const { t } = useI18n();

  if (webMode) {
    return <button className="primary" onClick={() => void onAddFolder()}>{t('app.addFolder')}</button>;
  }

  return (
    <div className="add-folder-split-button">
      <button className="primary add-folder-main" onClick={() => void onAddFolder()}>
        {t('app.addFolder')}
      </button>
      <details className="add-folder-menu">
        <summary aria-label={t('workspace.addFolderOptions')} title={t('workspace.addFolderOptions')}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path fill="currentColor" d="M4.2 6.2a.75.75 0 0 1 1.06 0L8 8.94l2.74-2.74a.75.75 0 1 1 1.06 1.06l-3.27 3.27a.75.75 0 0 1-1.06 0L4.2 7.26a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </summary>
        <div className="add-folder-menu-popover">
          <button
            type="button"
            onClick={event => {
              const details = event.currentTarget.closest('details');
              if (details instanceof HTMLDetailsElement) details.open = false;
              void onAddGitRepositories();
            }}
          >
            {t('workspace.addGitRepositories')}
          </button>
        </div>
      </details>
    </div>
  );
}

export default function WorkspaceView({ folders, activeId, onAddFolder, onAddGitRepositories, onImportDroppedFolder, onOpenFolder, onRemoveFolder, webMode }: Props) {
  const { locale, t } = useI18n();
  const [repoInfoByFolder, setRepoInfoByFolder] = useState<Record<number, GitRepoInfo | null>>({});
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [sortByCommit, setSortByCommit] = useState(false);
  const [commitSortAsc, setCommitSortAsc] = useState(false);

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

  function daysSinceCommit(value: number | null | undefined): number | null {
    if (!value) return null;
    return Math.floor((Date.now() - value) / 86400000);
  }

  function formatDaysAgo(days: number | null): string | null {
    if (days === null) return null;
    if (days === 0) return t('workspace.daysAgo_one', { count: 0 });
    return t('workspace.daysAgo', { count: days });
  }

  function commitStaleClass(days: number | null): string {
    if (days === null) return '';
    if (days <= 7) return 'commit-fresh';
    if (days <= 30) return 'commit-warn';
    return 'commit-stale';
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

  async function importFromDrop(dataTransfer: DataTransfer): Promise<void> {
    if (!onImportDroppedFolder) return;
    setImportError('');
    setImporting(true);

    try {
      await onImportDroppedFolder(dataTransfer);
    } catch {
      setImportError(t('workspace.importFailed'));
    } finally {
      setImporting(false);
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault();
    if (!webMode) return;
    setDragActive(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault();
    if (!webMode) return;
    setDragActive(false);
  }

  function handleDrop(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault();
    if (!webMode) return;
    setDragActive(false);
    void importFromDrop(event.dataTransfer);
  }

  const sortedFolders = useMemo(() => {
    if (!sortByCommit) return folders;
    return [...folders].sort((a, b) => {
      const da = repoInfoByFolder[a.id]?.lastCommitDate ?? null;
      const db2 = repoInfoByFolder[b.id]?.lastCommitDate ?? null;
      if (da === null && db2 === null) return 0;
      if (da === null) return 1;
      if (db2 === null) return -1;
      return commitSortAsc ? da - db2 : db2 - da;
    });
  }, [folders, sortByCommit, commitSortAsc, repoInfoByFolder]);

  return (
    <div>
      <PageHeader
        title={t('workspace.title')}
        description={t('workspace.subtitle')}
        meta={t('workspace.folderCount', { count: folders.length.toLocaleString(locale) })}
        actions={(
          <>
            <button
              className={'commit-sort-button' + (sortByCommit ? ' active' : '')}
              onClick={() => { setSortByCommit(!sortByCommit); if (sortByCommit) setCommitSortAsc(!commitSortAsc); }}
              title={sortByCommit ? (commitSortAsc ? t('workspace.sortOldestFirst') : t('workspace.sortNewestFirst')) : t('workspace.sortByCommitTitle')}
            >
              {t('workspace.sortByCommit')} {sortByCommit ? (commitSortAsc ? ' ▲' : ' ▼') : ''}
            </button>
            <AddFolderActions onAddFolder={onAddFolder} onAddGitRepositories={onAddGitRepositories} webMode={webMode} />
          </>
        )}
      />

      {webMode && (
        <section
          className={dragActive ? 'workspace-dropzone active' : 'workspace-dropzone'}
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="workspace-dropzone-copy">
            <span className="status-pill">{t('workspace.webMode')}</span>
            <h2>{t('workspace.webDropTitle')}</h2>
            <p>{t('workspace.webDropDescription')}</p>
            <div className="workspace-dropzone-note">{t('workspace.webDropNote')}</div>
          </div>
          <div className="action-strip workspace-dropzone-actions">
            <button className="primary" onClick={() => void onAddFolder()} disabled={importing}>
              {importing ? t('workspace.importing') : t('workspace.webPickFolder')}
            </button>
          </div>
          {importError && <div className="settings-field-note error">{importError}</div>}
        </section>
      )}

      {sortedFolders.length === 0 ? (
        <EmptyState
          title={t('workspace.emptyTitle')}
          description={t('workspace.addFirst')}
          action={<AddFolderActions onAddFolder={onAddFolder} onAddGitRepositories={onAddGitRepositories} webMode={webMode} />}
        />
      ) : (
        <div className="workspace-grid">
          {sortedFolders.map(folder => (
            <article
              key={folder.id}
              className={folder.id === activeId ? 'workspace-folder-card active' : 'workspace-folder-card'}
            >
              <div className="workspace-folder-topline">
                <span className="workspace-folder-name">{folder.name}</span>
                <details className="workspace-folder-menu">
                  <summary aria-label={t('workspace.moreActions')}>•••</summary>
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
              <div className="workspace-folder-path">{folder.rootPath}</div>
              {repoInfoByFolder[folder.id]?.remoteOriginWebUrl ? (
                <button
                  type="button"
                  className="workspace-link-button workspace-folder-link"
                  onClick={() => void window.api.system.openExternal(repoInfoByFolder[folder.id]!.remoteOriginWebUrl!)}
                >
                  {formatRemoteLabel(repoInfoByFolder[folder.id]!.remoteOriginWebUrl!)}
                </button>
              ) : (
                <span className="workspace-folder-meta-empty">{t('workspace.noRemoteOrigin')}</span>
              )}
              <div className="workspace-folder-footer">
                <div className="workspace-folder-commit">
                  <span className="workspace-folder-meta-label">{t('workspace.lastCommit')}</span>
                  <div className="workspace-folder-commit-row">
                    <span className="workspace-folder-meta-value">{formatCommitDate(repoInfoByFolder[folder.id]?.lastCommitDate)}</span>
                    {(() => {
                      const days = daysSinceCommit(repoInfoByFolder[folder.id]?.lastCommitDate);
                      const label = formatDaysAgo(days);
                      if (!label) return null;
                      return <span className={`workspace-commit-age ${commitStaleClass(days)}`}>{label}</span>;
                    })()}
                  </div>
                </div>
                <button onClick={() => onOpenFolder(folder.id)}>{t('workspace.openFolder')}</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
