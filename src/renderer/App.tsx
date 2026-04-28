import React, { useEffect, useState, useCallback, useRef } from 'react';
import { NavLink, Routes, Route, useNavigate } from 'react-router-dom';
import type { FolderRow, ScanProgress } from '../shared/api';
import Dashboard from './pages/Dashboard';
import FolderManager from './pages/FolderManager';
import TreeView from './pages/TreeView';
import FilesView from './pages/FilesView';
import TagsView from './pages/TagsView';
import TopView from './pages/TopView';
import HeatmapView from './pages/HeatmapView';
import DuplicatesView from './pages/DuplicatesView';
import EditorView from './pages/EditorView';
import WorkspaceView from './pages/WorkspaceView';
import { useI18n, type Language } from './i18n';

export default function App() {
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [scanRevision, setScanRevision] = useState(0);
  const [expandedTreePathsByFolder, setExpandedTreePathsByFolder] = useState<Record<number, string[]>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsDialogRef = useRef<HTMLDivElement | null>(null);
  const settingsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastCompletedScanKeyRef = useRef('');
  const navigate = useNavigate();
  const { language, languageOptions, setLanguage, t } = useI18n();

  const refreshFolders = useCallback(async () => {
    const list = await window.api.folders.list();
    setFolders(list);
    setActiveId(currentId => {
      if (currentId != null && list.some(folder => folder.id === currentId)) return currentId;
      return list[0]?.id ?? null;
    });
  }, []);

  useEffect(() => { refreshFolders(); }, [refreshFolders]);

  useEffect(() => {
    const off = window.api.scan.onProgress(p => setProgress(p));
    return off;
  }, []);

  useEffect(() => {
    if (progress?.phase !== 'done') return;
    const nextKey = `${progress.folderId}:${progress.done}:${progress.total}`;
    if (lastCompletedScanKeyRef.current === nextKey) return;
    lastCompletedScanKeyRef.current = nextKey;
    setScanRevision(current => current + 1);
  }, [progress?.done, progress?.folderId, progress?.phase, progress?.total]);

  useEffect(() => {
    if (!settingsOpen) return;

    settingsCloseButtonRef.current?.focus();

    function handleSettingsKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableElements = Array.from(
        settingsDialogRef.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])') ?? [],
      ).filter(element => !element.hasAttribute('disabled'));

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (!firstElement || !lastElement) return;

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener('keydown', handleSettingsKeyDown);
    return () => document.removeEventListener('keydown', handleSettingsKeyDown);
  }, [settingsOpen]);

  const active = folders.find(f => f.id === activeId) ?? null;
  const activeExpandedTreePaths = activeId == null ? [] : (expandedTreePathsByFolder[activeId] ?? ['']);
  const progressLabel = progress == null ? '' : {
    walking: t('progress.walking'),
    parsing: t('progress.parsing'),
    persisting: t('progress.persisting'),
    done: t('progress.done'),
  }[progress.phase];

  const handleTreeTogglePath = useCallback((folderId: number, treePath: string, open: boolean) => {
    setExpandedTreePathsByFolder(current => {
      const nextPaths = new Set(current[folderId] ?? ['']);
      if (open) nextPaths.add(treePath);
      else nextPaths.delete(treePath);
      return {
        ...current,
        [folderId]: Array.from(nextPaths),
      };
    });
  }, []);

  const handleAddFolder = useCallback(async () => {
    const dir = await window.api.folders.pickDirectory();
    if (!dir) return;

    const folder = await window.api.folders.add(dir);
    await refreshFolders();
    setActiveId(folder.id);
    navigate('/dashboard');
    void window.api.scan.run(folder.id, { detectDuplicates: true }).catch(() => undefined);
  }, [navigate, refreshFolders]);

  const handleOpenFolder = useCallback((folderId: number) => {
    setActiveId(folderId);
    navigate('/dashboard');
  }, [navigate]);

  const handleSelectFolder = useCallback((folderId: string) => {
    setActiveId(folderId === '' ? null : Number(folderId));
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-main">
          <h2>{t('app.currentFolder')}</h2>
          <select className="sidebar-folder-select" value={activeId ?? ''} onChange={e => handleSelectFolder(e.target.value)}>
            <option value="">{t('app.selectFolder')}</option>
            {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>

          <h2>{t('app.folders')}</h2>
          <NavLink to="/" end>{t('nav.workspace')}</NavLink>

          <h2>{t('app.views')}</h2>
          <NavLink to="/dashboard">{t('nav.dashboard')}</NavLink>
          <NavLink to="/folders">{t('nav.folderManager')}</NavLink>
          <NavLink to="/tree">{t('nav.tree')}</NavLink>
          <NavLink to="/files">{t('nav.files')}</NavLink>
          <NavLink to="/tags">{t('nav.tags')}</NavLink>
          <NavLink to="/top">{t('nav.top')}</NavLink>
          <NavLink to="/heatmap">{t('nav.heatmap')}</NavLink>
          <NavLink to="/duplicates">{t('nav.duplicates')}</NavLink>

          {progress && progress.phase !== 'done' && (
            <div style={{ marginTop: 16 }}>
              <small>{progressLabel} {progress.done}/{progress.total}</small>
              <div className="progress">
                <div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
              {progress.cacheHits != null && <small>{t('app.cacheHits', { count: progress.cacheHits })}</small>}
            </div>
          )}
        </div>

        <div className="sidebar-footer">
          <button className="settings-button" onClick={() => setSettingsOpen(true)}>{t('app.settings')}</button>
        </div>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<WorkspaceView folders={folders} onAddFolder={handleAddFolder} onOpenFolder={handleOpenFolder} />} />
          <Route path="/dashboard" element={<Dashboard folder={active} progress={progress} />} />
          <Route path="/folders" element={<FolderManager folder={active} onChanged={refreshFolders} />} />
          <Route
            path="/tree"
            element={(
              <TreeView
                folder={active}
                scanRevision={scanRevision}
                expandedPaths={activeExpandedTreePaths}
                onTogglePath={handleTreeTogglePath}
              />
            )}
          />
          <Route path="/files" element={<FilesView folder={active} scanRevision={scanRevision} />} />
          <Route path="/tags" element={<TagsView folder={active} scanRevision={scanRevision} />} />
          <Route path="/top" element={<TopView folder={active} scanRevision={scanRevision} />} />
          <Route path="/heatmap" element={<HeatmapView folder={active} scanRevision={scanRevision} />} />
          <Route path="/duplicates" element={<DuplicatesView folder={active} scanRevision={scanRevision} />} />
          <Route path="/editor/:relPath" element={<EditorView folder={active} scanRevision={scanRevision} />} />
        </Routes>
      </main>

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div ref={settingsDialogRef} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h1 id="settings-title">{t('app.settings')}</h1>
              <button ref={settingsCloseButtonRef} onClick={() => setSettingsOpen(false)}>{t('common.close')}</button>
            </div>
            <label className="settings-field">
              <span>{t('app.language')}</span>
              <select value={language} onChange={e => setLanguage(e.target.value as Language)}>
                {languageOptions.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
