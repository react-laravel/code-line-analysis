import React, { useEffect, useState, useCallback, useRef } from 'react';
import { NavLink, Routes, Route, useNavigate } from 'react-router-dom';
import { DEFAULT_BLACKLIST, type FolderRow, type FolderRules, type ScanProgress } from '../shared/api';
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

const primaryNavItems = [
  { to: '/dashboard', labelKey: 'nav.dashboard' },
  { to: '/folders', labelKey: 'nav.folderManager' },
] as const;

const analysisNavItems = [
  { to: '/tree', labelKey: 'nav.tree' },
  { to: '/files', labelKey: 'nav.files' },
  { to: '/top', labelKey: 'nav.top' },
  { to: '/heatmap', labelKey: 'nav.heatmap' },
  { to: '/tags', labelKey: 'nav.tags' },
  { to: '/duplicates', labelKey: 'nav.duplicates' },
] as const;

export default function App() {
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [scanRevision, setScanRevision] = useState(0);
  const [expandedTreePathsByFolder, setExpandedTreePathsByFolder] = useState<Record<number, string[]>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'scan'>('general');
  const [globalWhiteText, setGlobalWhiteText] = useState('');
  const [globalBlackText, setGlobalBlackText] = useState(DEFAULT_BLACKLIST.join('\n'));
  const settingsDialogRef = useRef<HTMLDivElement | null>(null);
  const settingsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastCompletedScanKeyRef = useRef('');
  const navigate = useNavigate();
  const { language, languageOptions, locale, setLanguage, t } = useI18n();

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

    let ignore = false;
    setSettingsTab('general');

    void window.api.settings.getGlobalRules().then(rules => {
      if (ignore) return;
      setGlobalWhiteText(rules.whitelist.join('\n'));
      setGlobalBlackText(rules.blacklist.join('\n'));
    }).catch(() => undefined);

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
    return () => {
      ignore = true;
      document.removeEventListener('keydown', handleSettingsKeyDown);
    };
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

  const handleTreeReplacePaths = useCallback((folderId: number, paths: string[]) => {
    setExpandedTreePathsByFolder(current => ({
      ...current,
      [folderId]: Array.from(new Set(paths.filter(Boolean))),
    }));
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

  const handleRemoveFolder = useCallback(async (folder: FolderRow) => {
    if (!confirm(t('folderManager.removeConfirm', { name: folder.name }))) return;
    await window.api.folders.remove(folder.id);
    await refreshFolders();
  }, [refreshFolders, t]);

  const handleSelectFolder = useCallback((folderId: string) => {
    if (folderId === '') {
      setActiveId(null);
      navigate('/');
      return;
    }

    setActiveId(Number(folderId));
  }, [navigate]);

  const handleSaveGlobalRules = useCallback(async () => {
    const rules: FolderRules = {
      whitelist: globalWhiteText.split('\n').map(pattern => pattern.trim()).filter(Boolean),
      blacklist: globalBlackText.split('\n').map(pattern => pattern.trim()).filter(Boolean),
    };
    await window.api.settings.setGlobalRules(rules);
  }, [globalBlackText, globalWhiteText]);

  const handleCancelScan = useCallback(() => {
    void window.api.scan.cancel().catch(() => undefined);
  }, []);

  const scanPercent = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const isScanning = progress != null && progress.phase !== 'done';

  function navClassName({ isActive }: { isActive: boolean }) {
    return isActive ? 'nav-link active' : 'nav-link';
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">CL</div>
          <div>
            <div className="brand-name">Code Line Analysis</div>
            <div className="brand-kicker">{t('app.productKicker')}</div>
          </div>
        </div>

        <div className="sidebar-main">
          <section className="sidebar-section folder-section">
            <div className="section-label">{t('nav.workspace')}</div>
            <select
              aria-label={t('app.selectedFolder')}
              className="sidebar-folder-select"
              value={activeId ?? ''}
              onChange={e => handleSelectFolder(e.target.value)}
            >
              <option value="">{t('app.selectFolder')}</option>
              {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
          </section>

          <nav className="sidebar-nav" aria-label={t('app.views')}>
            <section className="sidebar-section">
              <div className="section-label">{t('app.navPrimary')}</div>
              {primaryNavItems.map(item => (
                <NavLink key={item.to} to={item.to} className={navClassName}>{t(item.labelKey)}</NavLink>
              ))}
            </section>

            <section className="sidebar-section">
              <div className="section-label">{t('app.navAnalysis')}</div>
              {analysisNavItems.map(item => (
                <NavLink key={item.to} to={item.to} className={navClassName}>{t(item.labelKey)}</NavLink>
              ))}
            </section>
          </nav>

          {isScanning && (
            <section className="scan-panel" aria-live="polite">
              <div className="scan-panel-header">
                <span>{t('app.scanStatus')}</span>
                <strong>{scanPercent}%</strong>
              </div>
              <div className="progress">
                <div
                  role="progressbar"
                  aria-label={t('app.scanStatus')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={scanPercent}
                  style={{ width: `${scanPercent}%` }}
                />
              </div>
              <div className="scan-panel-copy">
                {progressLabel} {progress?.done.toLocaleString(locale)}/{progress?.total.toLocaleString(locale)}
              </div>
              {progress?.current && <div className="scan-current mono">{progress.current}</div>}
              {progress?.cacheHits != null && <div className="scan-panel-copy">{t('app.cacheHits', { count: progress.cacheHits })}</div>}
              <button type="button" onClick={handleCancelScan}>{t('app.cancelScan')}</button>
            </section>
          )}
        </div>

        <div className="sidebar-footer">
          <button className="settings-button" onClick={() => setSettingsOpen(true)}>{t('app.settings')}</button>
          <div className="app-version">v{__APP_VERSION__}</div>
        </div>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<WorkspaceView folders={folders} activeId={activeId} onAddFolder={handleAddFolder} onOpenFolder={handleOpenFolder} onRemoveFolder={handleRemoveFolder} />} />
          <Route path="/dashboard" element={<Dashboard folder={active} progress={progress} />} />
          <Route path="/folders" element={<FolderManager folder={active} />} />
          <Route
            path="/tree"
            element={(
              <TreeView
                folder={active}
                scanRevision={scanRevision}
                expandedPaths={activeExpandedTreePaths}
                onTogglePath={handleTreeTogglePath}
                onReplaceExpandedPaths={handleTreeReplacePaths}
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
            <div className="settings-tabs" role="tablist" aria-label={t('app.settings')}>
              <button
                type="button"
                role="tab"
                aria-selected={settingsTab === 'general'}
                className={settingsTab === 'general' ? 'settings-tab active' : 'settings-tab'}
                onClick={() => setSettingsTab('general')}
              >
                {t('settings.generalTab')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={settingsTab === 'scan'}
                className={settingsTab === 'scan' ? 'settings-tab active' : 'settings-tab'}
                onClick={() => setSettingsTab('scan')}
              >
                {t('settings.scanTab')}
              </button>
            </div>
            <div className="settings-tab-panel">
              {settingsTab === 'general' ? (
                <>
                  <p className="settings-copy">{t('settings.generalHelp')}</p>
                  <label className="settings-field">
                    <span>{t('app.language')}</span>
                    <select value={language} onChange={e => setLanguage(e.target.value as Language)}>
                      {languageOptions.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <p className="settings-copy">{t('settings.globalRulesHelp')}</p>
                  <div className="settings-rules-grid">
                    <label className="settings-field">
                      <span>{t('settings.globalWhitelist')}</span>
                      <textarea
                        className="settings-textarea"
                        value={globalWhiteText}
                        onChange={e => setGlobalWhiteText(e.target.value)}
                        rows={8}
                        placeholder={'src/**\nlib/**'}
                      />
                    </label>
                    <label className="settings-field">
                      <span>{t('settings.globalBlacklist')}</span>
                      <textarea
                        className="settings-textarea"
                        value={globalBlackText}
                        onChange={e => setGlobalBlackText(e.target.value)}
                        rows={8}
                        placeholder={DEFAULT_BLACKLIST.join('\n')}
                      />
                    </label>
                  </div>
                  <div className="settings-actions">
                    <button className="primary" onClick={() => void handleSaveGlobalRules()}>{t('settings.saveScanSettings')}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
