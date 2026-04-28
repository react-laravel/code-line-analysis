import React from 'react';
import type { FolderRow } from '../../shared/api';
import { useI18n } from '../i18n';

interface Props {
  folders: FolderRow[];
  onAddFolder: () => Promise<void>;
  onOpenFolder: (folderId: number) => void;
}

export default function WorkspaceView({ folders, onAddFolder, onOpenFolder }: Props) {
  const { locale, t } = useI18n();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{t('workspace.title')}</h1>
          <div className="muted">{t('workspace.subtitle')}</div>
        </div>
        <button className="primary" onClick={onAddFolder}>{t('app.addFolder')}</button>
      </div>

      {folders.length === 0 ? (
        <div className="empty">{t('workspace.addFirst')}</div>
      ) : (
        <div className="workspace-grid">
          {folders.map(folder => (
            <button key={folder.id} className="workspace-folder-card" onClick={() => onOpenFolder(folder.id)}>
              <span className="workspace-folder-name">{folder.name}</span>
              <span className="workspace-folder-path">{folder.rootPath}</span>
              <span className="workspace-folder-meta">
                {folder.baselineAt ? t('app.baselineAt', { date: new Date(folder.baselineAt).toLocaleString(locale) }) : t('app.noBaseline')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}