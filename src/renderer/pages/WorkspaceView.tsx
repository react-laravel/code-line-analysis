import React from 'react';
import type { FolderRow } from '../../shared/api';
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
              <span className="workspace-folder-topline">
                <span className="workspace-folder-name">{folder.name}</span>
                {folder.id === activeId && <span className="status-pill">{t('common.active')}</span>}
              </span>
              <span className="workspace-folder-path">{folder.rootPath}</span>
              <span className="workspace-folder-actions">
                <button onClick={() => onOpenFolder(folder.id)}>{t('workspace.openFolder')}</button>
                <button className="danger" onClick={() => void onRemoveFolder(folder)}>{t('folderManager.remove')}</button>
              </span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}