import React, { useEffect, useLayoutEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FolderRow, DuplicateCluster } from '../../shared/api';
import { useI18n } from '../i18n';
import PageHeader from '../components/PageHeader';

interface Props {
  folder: FolderRow | null;
  scanRevision: number;
}

export default function DuplicatesView({ folder, scanRevision }: Props) {
  const [clusters, setClusters] = useState<DuplicateCluster[]>([]);
  const [duplicateMinLines, setDuplicateMinLines] = useState(8);
  const [duplicateMinLinesText, setDuplicateMinLinesText] = useState('8');
  const [applying, setApplying] = useState(false);
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const scrollStorageKey = folder ? `duplicates-scroll:${folder.id}` : '';

  useEffect(() => {
    if (!folder) return;
    window.api.stats.duplicates(folder.id).then(setClusters);
  }, [folder?.id, scanRevision]);

  useEffect(() => {
    if (!folder) return;
    void window.api.folders.getDuplicateMinLines(folder.id).then(count => {
      setDuplicateMinLines(count);
      setDuplicateMinLinesText(String(count));
    }).catch(() => undefined);
  }, [folder?.id]);

  const parsedDuplicateMinLines = Number(duplicateMinLinesText);
  const duplicateMinLinesError = Number.isInteger(parsedDuplicateMinLines) && parsedDuplicateMinLines >= 3
    ? null
    : t('settings.duplicateMinLinesError');

  async function applyDuplicateMinLines(nextValue: number): Promise<void> {
    if (!folder) return;
    if (duplicateMinLinesError || parsedDuplicateMinLines === duplicateMinLines) return;
    setApplying(true);
    try {
      await window.api.folders.setDuplicateMinLines(folder.id, nextValue);
      setDuplicateMinLines(nextValue);
      setDuplicateMinLinesText(String(nextValue));
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
