import React, { useEffect, useLayoutEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FolderRow, DuplicateCluster, FolderRules } from '../../shared/api';
import { useI18n } from '../i18n';
import PageHeader from '../components/PageHeader';

interface Props {
  folder: FolderRow | null;
  scanRevision: number;
}

function getDuplicateRuleErrorMessage(error: unknown, fallback: string, unavailable: string): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/No handler registered|setDuplicateRules is not a function|getDuplicateRules is not a function/i.test(message)) {
    return unavailable;
  }
  return fallback;
}

function normalizeRules(value: FolderRules | null | undefined): FolderRules {
  return {
    whitelist: Array.isArray(value?.whitelist) ? value.whitelist : [],
    blacklist: Array.isArray(value?.blacklist) ? value.blacklist : [],
  };
}

export default function DuplicatesView({ folder, scanRevision }: Props) {
  const [clusters, setClusters] = useState<DuplicateCluster[]>([]);
  const [duplicateMinLines, setDuplicateMinLines] = useState(8);
  const [duplicateMinLinesText, setDuplicateMinLinesText] = useState('8');
  const [applying, setApplying] = useState(false);
  const [duplicateRules, setDuplicateRules] = useState<FolderRules>({ whitelist: [], blacklist: [] });
  const [duplicateWhiteText, setDuplicateWhiteText] = useState('');
  const [duplicateBlackText, setDuplicateBlackText] = useState('');
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesMessage, setRulesMessage] = useState('');
  const [rulesError, setRulesError] = useState('');
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const scrollStorageKey = folder ? `duplicates-scroll:${folder.id}` : '';
  const duplicateRuleApisAvailable = typeof window.api.folders.getDuplicateRules === 'function'
    && typeof window.api.folders.setDuplicateRules === 'function';

  async function loadClusters(folderId: number): Promise<void> {
    const nextClusters = await window.api.stats.duplicates(folderId);
    setClusters(nextClusters);
  }

  useEffect(() => {
    if (!folder) return;
    void loadClusters(folder.id);
  }, [folder?.id, scanRevision]);

  useEffect(() => {
    if (!folder) return;
    void window.api.folders.getDuplicateMinLines(folder.id).then(count => {
      setDuplicateMinLines(count);
      setDuplicateMinLinesText(String(count));
    }).catch(() => undefined);
  }, [folder?.id]);

  useEffect(() => {
    if (!folder) {
      setDuplicateRules({ whitelist: [], blacklist: [] });
      setDuplicateWhiteText('');
      setDuplicateBlackText('');
      setRulesMessage('');
      setRulesError('');
      return;
    }

    if (!duplicateRuleApisAvailable) {
      setRulesError(t('duplicates.rulesUnavailable'));
      return;
    }

    void window.api.folders.getDuplicateRules(folder.id).then(rules => {
      const nextRules = normalizeRules(rules);
      setDuplicateRules(nextRules);
      setDuplicateWhiteText(nextRules.whitelist.join('\n'));
      setDuplicateBlackText(nextRules.blacklist.join('\n'));
      setRulesMessage('');
      setRulesError('');
    }).catch(error => {
      setRulesError(getDuplicateRuleErrorMessage(error, t('duplicates.rulesFailed'), t('duplicates.rulesUnavailable')));
    });
  }, [duplicateRuleApisAvailable, folder?.id, t]);

  const parsedDuplicateMinLines = Number(duplicateMinLinesText);
  const duplicateMinLinesError = Number.isInteger(parsedDuplicateMinLines) && parsedDuplicateMinLines >= 3
    ? null
    : t('settings.duplicateMinLinesError');

  async function applyDuplicateMinLines(nextValue: number): Promise<void> {
    if (!folder) return;
    if (!Number.isInteger(nextValue) || nextValue < 3 || nextValue === duplicateMinLines) return;
    setApplying(true);
    try {
      await window.api.folders.setDuplicateMinLines(folder.id, nextValue);
      setDuplicateMinLines(nextValue);
      setDuplicateMinLinesText(String(nextValue));
      await loadClusters(folder.id);
    } finally {
      setApplying(false);
    }
  }

  useEffect(() => {
    if (!folder || duplicateMinLinesError || parsedDuplicateMinLines === duplicateMinLines) return;
    const timer = window.setTimeout(() => {
      void applyDuplicateMinLines(parsedDuplicateMinLines);
    }, 550);
    return () => window.clearTimeout(timer);
  }, [duplicateMinLines, duplicateMinLinesError, folder, parsedDuplicateMinLines]);

  function bumpDuplicateMinLines(delta: number): void {
    const nextValue = Math.max(3, duplicateMinLines + delta);
    setDuplicateMinLinesText(String(nextValue));
  }

  async function saveDuplicateRules(): Promise<void> {
    if (!folder) return;
    if (!duplicateRuleApisAvailable) {
      setRulesError(t('duplicates.rulesUnavailable'));
      return;
    }

    const nextRules: FolderRules = {
      whitelist: duplicateWhiteText.split('\n').map(pattern => pattern.trim()).filter(Boolean),
      blacklist: duplicateBlackText.split('\n').map(pattern => pattern.trim()).filter(Boolean),
    };

    setRulesSaving(true);
    setRulesMessage('');
    setRulesError('');

    try {
      const response = await window.api.folders.setDuplicateRules(folder.id, nextRules);
      const persistedRules = Array.isArray(response?.whitelist) && Array.isArray(response?.blacklist)
        ? normalizeRules(response)
        : normalizeRules(await window.api.folders.getDuplicateRules(folder.id).catch(() => nextRules));
      setDuplicateRules(persistedRules);
      setDuplicateWhiteText(persistedRules.whitelist.join('\n'));
      setDuplicateBlackText(persistedRules.blacklist.join('\n'));
      setRulesMessage(t('duplicates.rulesApplied'));
    } catch (error) {
      setRulesError(getDuplicateRuleErrorMessage(error, t('duplicates.rulesFailed'), t('duplicates.rulesUnavailable')));
    } finally {
      setRulesSaving(false);
    }
  }

  function getScrollContainer() {
    return document.querySelector<HTMLElement>('.content');
  }

  function saveScrollPosition() {
    if (!scrollStorageKey) return;
    try {
      window.sessionStorage.setItem(scrollStorageKey, String(getScrollContainer()?.scrollTop ?? 0));
    } catch {
      // Ignore storage failures; navigation should still work normally.
    }
  }

  useLayoutEffect(() => {
    if (!scrollStorageKey) return;

    let savedPosition = 0;
    try {
      savedPosition = Number(window.sessionStorage.getItem(scrollStorageKey) ?? 0);
    } catch {
      savedPosition = 0;
    }

    if (savedPosition <= 0) return;

    const frameId = window.requestAnimationFrame(() => {
      getScrollContainer()?.scrollTo({ top: savedPosition });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [clusters.length, scrollStorageKey]);

  useEffect(() => {
    if (!scrollStorageKey) return;

    const container = getScrollContainer();
    if (!container) return;

    container.addEventListener('scroll', saveScrollPosition, { passive: true });
    return () => container.removeEventListener('scroll', saveScrollPosition);
  }, [scrollStorageKey]);

  if (!folder) return <div className="empty">{t('common.selectFolder')}</div>;

  return (
    <div className="duplicates-page">
      <PageHeader
        title={t('duplicates.title', { count: duplicateMinLines.toLocaleString(locale) })}
        description={t('duplicates.help')}
        actions={(
          <div className="duplicates-toolbar">
            <label className="page-select-field duplicates-setting-field">
              <span>{t('duplicates.minLines')}</span>
              <button type="button" onClick={() => bumpDuplicateMinLines(-1)} disabled={applying || duplicateMinLines <= 3}>-</button>
              <input
                type="number"
                min={3}
                step={1}
                value={duplicateMinLinesText}
                onChange={event => setDuplicateMinLinesText(event.target.value)}
                className="duplicates-number-input"
              />
              <button type="button" onClick={() => bumpDuplicateMinLines(1)} disabled={applying}>+</button>
            </label>
          </div>
        )}
      />
      <div className={duplicateMinLinesError ? 'settings-field-note error' : 'settings-field-note'}>
        {duplicateMinLinesError ?? (applying ? t('duplicates.refreshing') : t('duplicates.settingHelp'))}
      </div>
      <section className="filter-panel">
        <div className="filter-panel-header">
          <strong>{t('duplicates.rules')}</strong>
          <span className="status-pill">
            {t('folderManager.activeRules', {
              whitelist: duplicateRules.whitelist.length.toLocaleString(locale),
              blacklist: duplicateRules.blacklist.length.toLocaleString(locale),
            })}
          </span>
        </div>
        <p className="settings-copy">{t('duplicates.rulesHelp')}</p>
        <div className="rules-grid" style={{ marginTop: 12 }}>
          <div>
            <h2>{t('folderManager.whitelist')}</h2>
            <textarea
              value={duplicateWhiteText}
              onChange={event => {
                setDuplicateWhiteText(event.target.value);
                setRulesMessage('');
                setRulesError('');
              }}
              rows={8}
              className="rules-textarea"
              placeholder={'src/**\nlib/**'}
            />
          </div>
          <div>
            <h2>{t('folderManager.blacklist')}</h2>
            <textarea
              value={duplicateBlackText}
              onChange={event => {
                setDuplicateBlackText(event.target.value);
                setRulesMessage('');
                setRulesError('');
              }}
              rows={8}
              className="rules-textarea"
              placeholder={'vendor\n**/__generated__/**'}
            />
          </div>
        </div>
        <div className="settings-actions" style={{ marginTop: 12 }}>
          <button type="button" className="primary" onClick={() => void saveDuplicateRules()} disabled={rulesSaving}>
            {rulesSaving ? t('folderManager.saving') : t('duplicates.saveRules')}
          </button>
        </div>
        {(rulesMessage || rulesError) && (
          <div className={rulesError ? 'settings-field-note error' : 'settings-field-note'}>
            {rulesError || rulesMessage}
          </div>
        )}
      </section>
      {clusters.length === 0 && <div className="empty">{t('duplicates.empty')}</div>}
      {clusters.map(c => (
        <div key={c.hash} className="card" style={{ marginBottom: 8 }}>
          <div className="muted">{t('duplicates.hash')}: {c.hash} · {c.occurrences.length.toLocaleString(locale)} {t('duplicates.occurrences')} · {c.lines.toLocaleString(locale)} {t('common.lines')}</div>
          {c.occurrences.map((o, i) => (
            <div key={i} className="mono" style={{ cursor: 'pointer' }}
                 onClick={() => {
                   saveScrollPosition();
                   navigate(`/editor/${encodeURIComponent(o.relPath)}?line=${o.startLine}&endLine=${o.endLine}&highlight=duplicate`);
                 }}>
              {o.relPath}:{o.startLine}-{o.endLine}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
