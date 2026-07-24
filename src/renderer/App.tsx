import React, { useEffect, useState, useCallback, useRef } from 'react';
import { NavLink, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Braces,
  CircleAlert,
  Copy,
  Database,
  Files,
  FolderCog,
  FolderKanban,
  FolderOpen,
  FolderTree,
  GitBranch,
  Globe2,
  ListTree,
  Route as RouteIcon,
  Settings,
  Share2,
  Sun,
  Moon,
  Tags,
  X,
} from 'lucide-react';
import { DEFAULT_BLACKLIST, type FolderRow, type FolderRules, type FolderStats, type ScanProgress } from '../shared/api';
import Dashboard from './pages/Dashboard';
import FolderManager from './pages/FolderManager';
import TreeView from './pages/TreeView';
import FilesView from './pages/FilesView';
import TagsView from './pages/TagsView';
import TopView from './pages/TopView';
import HeatmapView from './pages/HeatmapView';
import DuplicatesView from './pages/DuplicatesView';
import RelationsView from './pages/RelationsView';
import ApiRoutesView from './pages/ApiRoutesView';
import LaravelSchemaView from './pages/LaravelSchemaView';
import EditorView from './pages/EditorView';
import WorkspaceView from './pages/WorkspaceView';
import { useI18n, type Language } from './i18n';
import { useTheme, type ThemeMode } from './theme';

const primaryNavItems = [
  { to: '/', labelKey: 'nav.workspace', icon: FolderKanban },
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: BarChart3 },
  { to: '/folders', labelKey: 'nav.folderManager', icon: FolderCog },
] as const;

const analysisNavItems = [
  { to: '/tree', labelKey: 'nav.tree', icon: FolderTree },
  { to: '/files', labelKey: 'nav.files', icon: Files },
  { to: '/top', labelKey: 'nav.top', icon: Braces },
  { to: '/heatmap', labelKey: 'nav.heatmap', icon: GitBranch },
  { to: '/api-routes', labelKey: 'nav.apiRoutes', icon: RouteIcon },
  { to: '/relations', labelKey: 'nav.relations', icon: Share2 },
  { to: '/laravel-schema', labelKey: 'nav.laravelSchema', icon: Database },
  { to: '/tags', labelKey: 'nav.tags', icon: Tags },
  { to: '/duplicates', labelKey: 'nav.duplicates', icon: Copy },
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
  const location = useLocation();
  const { language, languageOptions, locale, setLanguage, t } = useI18n();
  const { theme, setTheme } = useTheme();

  const refreshFolders = useCallback(async () => {
    const list = await window.api.folders.list();
    setFolders(list);
    setActiveId(currentId => {
      if (currentId != null && list.some(folder => folder.id === currentId)) return currentId;
      return list[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    void refreshFolders();
    const timer = window.setInterval(() => void refreshFolders(), 5000);
    return () => window.clearInterval(timer);
  }, [refreshFolders]);

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
    const folder = folders.find(item => item.id === activeId);
    if (!folder?.isAvailable) return;
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

  const scanAddedFolder = useCallback((folderId: number) => {
    autoScannedFolderIdsRef.current.add(folderId);
    void window.api.scan.run(folderId, { detectDuplicates: true }).catch(() => {
      autoScannedFolderIdsRef.current.delete(folderId);
    });
  }, []);

  const handleAddFolder = useCallback(async () => {
    const token = await window.api.folders.pickDirectory();
    if (!token) return;

    const folder = await window.api.folders.add(token);
    await refreshFolders();
    setActiveId(folder.id);
    navigate('/dashboard');
    scanAddedFolder(folder.id);
  }, [navigate, refreshFolders, scanAddedFolder]);

  const handleAddGitRepositories = useCallback(async () => {
    const token = await window.api.folders.pickDirectory();
    if (!token) return;

    let addedFolders: FolderRow[];
    try {
      if (typeof window.api.folders.addGitRepositories !== 'function') {
        alert(t('workspace.addGitRepositoriesRestartRequired'));
        return;
      }

      addedFolders = await window.api.folders.addGitRepositories(token);
      if (addedFolders.length === 0) {
        alert(t('workspace.noGitRepositoriesFound'));
        return;
      }
    } catch (error) {
      console.error('Add Git repositories failed:', error);
      const detail = error instanceof Error ? error.message : String(error ?? '');
      if (detail.includes('No handler registered') || detail.includes('folders:addGitRepositories')) {
        alert(t('workspace.addGitRepositoriesRestartRequired'));
        return;
      }
      alert(t('workspace.addGitRepositoriesFailed', { detail: detail || '-' }));
      return;
    }

    await refreshFolders();
    setActiveId(addedFolders[0].id);
    navigate('/dashboard');
    for (const folder of addedFolders) scanAddedFolder(folder.id);
    alert(t('workspace.gitRepositoriesAdded', { count: addedFolders.length }));
  }, [navigate, refreshFolders, scanAddedFolder, t]);

  const handleOpenFolder = useCallback((folderId: number) => {
    setActiveId(folderId);
    navigate('/dashboard');
  }, [navigate]);

  const handleRemoveFolder = useCallback(async (folder: FolderRow) => {
    if (!confirm(t('folderManager.removeConfirm', { name: folder.name }))) return;
    await window.api.folders.remove(folder.id);
    await refreshFolders();
  }, [refreshFolders, t]);

  const handleRelocateFolder = useCallback(async (folder: FolderRow) => {
    const rootPath = await window.api.folders.pickDirectory();
    if (!rootPath) return;

    try {
      const relocated = await window.api.folders.relocate(folder.id, rootPath);
      await refreshFolders();
      setActiveId(relocated.id);
      scanAddedFolder(relocated.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error ?? '');
      alert(t('workspace.relocateFailed', { detail: detail || '-' }));
    }
  }, [refreshFolders, scanAddedFolder, t]);

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
  }, [globalBlackText, globalWhiteText, t]);

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
          <div className="brand-copy">
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
              {folders.map(folder => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}{folder.isAvailable ? '' : ` · ${t('workspace.missingShort')}`}
                </option>
              ))}
            </select>
            {active && (
              <div className={active.isAvailable ? 'sidebar-workspace-status' : 'sidebar-workspace-status missing'}>
                <span className="status-dot" aria-hidden="true" />
                <span className="sidebar-workspace-path">{active.isAvailable ? active.rootPath : t('workspace.locationMissing')}</span>
                {!active.isAvailable ? (
                  <button type="button" className="sidebar-relocate-button" onClick={() => void handleRelocateFolder(active)}>
                    {t('workspace.relocate')}
                  </button>
                ) : null}
              </div>
            )}
          </section>

          <nav className="sidebar-nav" aria-label={t('app.views')}>
            <section className="sidebar-section">
              <div className="section-label">{t('app.navPrimary')}</div>
              {primaryNavItems.map(item => (
                <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navClassName}>
                  <item.icon className="nav-link-icon" aria-hidden="true" />
                  <span className="nav-link-label">{t(item.labelKey)}</span>
                </NavLink>
              ))}
            </section>

            <section className="sidebar-section">
              <div className="section-label">{t('app.navAnalysis')}</div>
              {analysisNavItems.map(item => (
                <NavLink key={item.to} to={item.to} className={navClassName}>
                  <item.icon className="nav-link-icon" aria-hidden="true" />
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
            <Settings className="settings-icon" aria-hidden="true" />
          </button>
          <div className="app-version">v{__APP_VERSION__}</div>
        </div>
      </aside>

      <main className="content">
        {active && !active.isAvailable && location.pathname !== '/' ? (
          <section className="workspace-unavailable-panel" role="alert">
            <div className="workspace-unavailable-icon"><CircleAlert aria-hidden="true" /></div>
            <div className="workspace-unavailable-copy">
              <span className="eyebrow">{active.name}</span>
              <h1>{t('workspace.locationMissing')}</h1>
              <p>{t('workspace.locationMissingHelp', { path: active.rootPath })}</p>
              <button type="button" className="primary icon-text-button" onClick={() => void handleRelocateFolder(active)}>
                <FolderOpen aria-hidden="true" />
                {t('workspace.relocate')}
              </button>
            </div>
          </section>
        ) : <Routes>
          <Route
            path="/"
            element={(
              <WorkspaceView
                folders={folders}
                activeId={activeId}
                onAddFolder={handleAddFolder}
                onAddGitRepositories={handleAddGitRepositories}
                onOpenFolder={handleOpenFolder}
                onRemoveFolder={handleRemoveFolder}
                onRelocateFolder={handleRelocateFolder}
              />
            )}
          />
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
          <Route path="/api-routes" element={<ApiRoutesView folder={active} scanRevision={scanRevision} />} />
          <Route path="/relations" element={<RelationsView folder={active} scanRevision={scanRevision} />} />
          <Route path="/laravel-schema" element={<LaravelSchemaView folder={active} scanRevision={scanRevision} />} />
          <Route path="/duplicates" element={<DuplicatesView folder={active} scanRevision={scanRevision} />} />
          <Route path="/editor/:relPath" element={<EditorView folder={active} scanRevision={scanRevision} />} />
        </Routes>}
      </main>

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div ref={settingsDialogRef} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="eyebrow">Code Line Analysis</div>
                <h1 id="settings-title">{t('app.settings')}</h1>
              </div>
              <button ref={settingsCloseButtonRef} className="icon-button" aria-label={t('common.close')} title={t('common.close')} onClick={() => setSettingsOpen(false)}>
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="settings-tabs" role="tablist" aria-label={t('app.settings')}>
              <button
                type="button"
                role="tab"
                aria-selected={settingsTab === 'general'}
                className={settingsTab === 'general' ? 'settings-tab active' : 'settings-tab'}
                onClick={() => setSettingsTab('general')}
              >
                <Globe2 aria-hidden="true" />
                {t('settings.generalTab')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={settingsTab === 'scan'}
                className={settingsTab === 'scan' ? 'settings-tab active' : 'settings-tab'}
                onClick={() => setSettingsTab('scan')}
              >
                <ListTree aria-hidden="true" />
                {t('settings.scanTab')}
              </button>
            </div>
            <div className="settings-tab-panel">
              {settingsTab === 'general' ? (
                <>
                  <p className="settings-copy">{t('settings.generalHelp')}</p>
                  <div className="settings-option-row">
                    <div className="settings-option-copy">
                      <strong>{t('app.language')}</strong>
                      <span>{t('settings.languageHelp')}</span>
                    </div>
                    <select aria-label={t('app.language')} value={language} onChange={e => setLanguage(e.target.value as Language)}>
                      {languageOptions.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}
                    </select>
                  </div>
                  <div className="settings-option-row">
                    <div className="settings-option-copy">
                      <strong>{t('settings.theme')}</strong>
                      <span>{t('settings.themeHelp')}</span>
                    </div>
                    <div className="theme-segmented-control" role="group" aria-label={t('settings.theme')}>
                      {([
                        ['light', t('settings.themeLight'), Sun],
                        ['dark', t('settings.themeDark'), Moon],
                      ] as const).map(([value, label, Icon]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={theme === value}
                          className={theme === value ? 'theme-option active' : 'theme-option'}
                          onClick={() => setTheme(value as ThemeMode)}
                        >
                          <Icon aria-hidden="true" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
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
