import React, { useEffect, useState, useCallback, useRef } from 'react';
import { NavLink, Routes, Route, useNavigate } from 'react-router-dom';
import { DEFAULT_BLACKLIST, type FolderRow, type FolderRules, type FolderStats, type ScanProgress } from '../shared/api';
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

function normalizeRules(value: FolderRules | null | undefined): FolderRules {
  return {
    whitelist: Array.isArray(value?.whitelist) ? value.whitelist : [],
    blacklist: Array.isArray(value?.blacklist) ? value.blacklist : [],
  };
}

export default function App() {
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [activeSummary, setActiveSummary] = useState<FolderStats | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [scanRevision, setScanRevision] = useState(0);
  const [expandedTreePathsByFolder, setExpandedTreePathsByFolder] = useState<Record<number, string[]>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'scan'>('general');
  const [globalWhiteText, setGlobalWhiteText] = useState('');
  const [globalBlackText, setGlobalBlackText] = useState(DEFAULT_BLACKLIST.join('\n'));
  const [globalRulesSaving, setGlobalRulesSaving] = useState(false);
  const [globalRulesMessage, setGlobalRulesMessage] = useState('');
  const [globalRulesError, setGlobalRulesError] = useState('');
  const settingsDialogRef = useRef<HTMLDivElement | null>(null);
  const settingsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const autoScannedFolderIdsRef = useRef<Set<number>>(new Set());
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
    let ignore = false;

    if (activeId == null) {
      setActiveSummary(null);
      return () => { ignore = true; };
    }

    void window.api.stats.summary(activeId).then(summary => {
      if (!ignore) setActiveSummary(summary);
    }).catch(() => {
      if (!ignore) setActiveSummary(null);
    });

    return () => { ignore = true; };
  }, [activeId, scanRevision]);

  useEffect(() => {
    const activeFolderIds = new Set(folders.map(folder => folder.id));
    autoScannedFolderIdsRef.current = new Set(
      Array.from(autoScannedFolderIdsRef.current).filter(folderId => activeFolderIds.has(folderId)),
    );
  }, [folders]);

  useEffect(() => {
    if (activeId == null) return;
    if (!folders.some(folder => folder.id === activeId)) return;
    if (autoScannedFolderIdsRef.current.has(activeId)) return;

    autoScannedFolderIdsRef.current.add(activeId);
    void window.api.scan.run(activeId, { detectDuplicates: true }).catch(() => {
      autoScannedFolderIdsRef.current.delete(activeId);
    });
  }, [activeId, folders]);

  useEffect(() => {
    if (progress?.phase !== 'done') return;
    setScanRevision(current => current + 1);
  }, [progress?.done, progress?.folderId, progress?.phase, progress?.total]);

  useEffect(() => {
    if (!settingsOpen) return;

    let ignore = false;
    setSettingsTab('general');

    void window.api.settings.getGlobalRules().then(rules => {
      if (ignore) return;
      const nextRules = normalizeRules(rules);
      setGlobalWhiteText(nextRules.whitelist.join('\n'));
      setGlobalBlackText(nextRules.blacklist.join('\n'));
      setGlobalRulesMessage('');
      setGlobalRulesError('');
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
  const activeTagCount = activeSummary
    ? Object.values(activeSummary.tagCounts).reduce((sum, count) => sum + count, 0)
    : null;
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
    autoScannedFolderIdsRef.current.add(folder.id);
    void window.api.scan.run(folder.id, { detectDuplicates: true }).catch(() => {
      autoScannedFolderIdsRef.current.delete(folder.id);
    });
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
    setGlobalRulesSaving(true);
    setGlobalRulesMessage('');
    setGlobalRulesError('');

    try {
      const response = await window.api.settings.setGlobalRules(rules);
      const nextRules = Array.isArray(response?.whitelist) && Array.isArray(response?.blacklist)
        ? normalizeRules(response)
        : normalizeRules(await window.api.settings.getGlobalRules().catch(() => rules));
      setGlobalWhiteText(nextRules.whitelist.join('\n'));
      setGlobalBlackText(nextRules.blacklist.join('\n'));
      setGlobalRulesMessage(t('settings.saveApplied'));
    } catch {
      setGlobalRulesError(t('settings.saveFailed'));
    } finally {
      setGlobalRulesSaving(false);
    }
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
                <NavLink key={item.to} to={item.to} className={navClassName}>
                  <span className="nav-link-label">{t(item.labelKey)}</span>
                </NavLink>
              ))}
            </section>

            <section className="sidebar-section">
              <div className="section-label">{t('app.navAnalysis')}</div>
              {analysisNavItems.map(item => (
                <NavLink key={item.to} to={item.to} className={navClassName}>
                  <span className="nav-link-label">{t(item.labelKey)}</span>
                  {item.to === '/tags' && activeTagCount != null ? (
                    <span className="nav-link-badge">{activeTagCount.toLocaleString(locale)}</span>
                  ) : null}
                </NavLink>
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
          <button
            type="button"
            className="settings-button"
            aria-label={t('app.openSettings')}
            title={t('app.settings')}
            onClick={() => setSettingsOpen(true)}
          >
            <svg className="settings-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.07-.94l2.03-1.58a.48.48 0 0 0 .11-.61l-1.92-3.32a.5.5 0 0 0-.58-.22l-2.39.96a7.14 7.14 0 0 0-1.63-.94l-.36-2.54A.49.49 0 0 0 13.9 2h-3.8a.49.49 0 0 0-.49.41l-.36 2.54c-.58.22-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.58.22L2.73 8.47a.48.48 0 0 0 .11.61l2.03 1.58c-.05.31-.07.63-.07.94s.02.63.07.94l-2.03 1.58a.48.48 0 0 0-.11.61l1.92 3.32c.13.22.39.31.58.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54c.05.24.25.41.49.41h3.8c.24 0 .44-.17.49-.41l.36-2.54c.58-.22 1.12-.54 1.63-.94l2.39.96c.19.09.45 0 .58-.22l1.92-3.32a.48.48 0 0 0-.11-.61l-2.02-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
              />
            </svg>
          </button>
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
                        onChange={e => {
                          setGlobalWhiteText(e.target.value);
                          setGlobalRulesMessage('');
                          setGlobalRulesError('');
                        }}
                        rows={8}
                        placeholder={'src/**\nlib/**'}
                      />
                    </label>
                    <label className="settings-field">
                      <span>{t('settings.globalBlacklist')}</span>
                      <textarea
                        className="settings-textarea"
                        value={globalBlackText}
                        onChange={e => {
                          setGlobalBlackText(e.target.value);
                          setGlobalRulesMessage('');
                          setGlobalRulesError('');
                        }}
                        rows={8}
                        placeholder={DEFAULT_BLACKLIST.join('\n')}
                      />
                    </label>
                  </div>
                  <div className="settings-actions">
                    <button className="primary" onClick={() => void handleSaveGlobalRules()} disabled={globalRulesSaving}>
                      {globalRulesSaving ? t('settings.saving') : t('settings.saveScanSettings')}
                    </button>
                  </div>
                  {(globalRulesMessage || globalRulesError) && (
                    <div className={globalRulesError ? 'settings-field-note error' : 'settings-field-note'}>
                      {globalRulesError || globalRulesMessage}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
