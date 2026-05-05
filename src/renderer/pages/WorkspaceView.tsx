import React, { useEffect, useState } from 'react';
import type { FolderRow, GitRepoInfo } from '../../shared/api';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import { useI18n } from '../i18n';

interface Props {
  folders: FolderRow[];
  activeId: number | null;
  onAddFolder: () => Promise<void>;
  onImportDroppedFolder?: (dataTransfer: DataTransfer) => Promise<void>;
  onOpenFolder: (folderId: number) => void;
  onRemoveFolder: (folder: FolderRow) => Promise<void>;
  webMode: boolean;
}

export default function WorkspaceView({ folders, activeId, onAddFolder, onImportDroppedFolder, onOpenFolder, onRemoveFolder, webMode }: Props) {
  const { locale, t } = useI18n();
  const [repoInfoByFolder, setRepoInfoByFolder] = useState<Record<number, GitRepoInfo | null>>({});
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

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

  return (
    <div>
      <PageHeader
        title={t('workspace.title')}
        description={t('workspace.subtitle')}
        meta={t('workspace.folderCount', { count: folders.length.toLocaleString(locale) })}
        actions={<button className="primary" onClick={onAddFolder}>{t('app.addFolder')}</button>}
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
                  <span className="workspace-folder-meta-value">{formatCommitDate(repoInfoByFolder[folder.id]?.lastCommitDate)}</span>
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