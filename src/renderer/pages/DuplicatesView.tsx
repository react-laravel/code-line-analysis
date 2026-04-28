import React, { useEffect, useLayoutEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FolderRow, DuplicateCluster } from '../../shared/api';
import { useI18n } from '../i18n';

interface Props {
  folder: FolderRow | null;
  scanRevision: number;
}

export default function DuplicatesView({ folder, scanRevision }: Props) {
  const [clusters, setClusters] = useState<DuplicateCluster[]>([]);
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const scrollStorageKey = folder ? `duplicates-scroll:${folder.id}` : '';

  useEffect(() => {
    if (!folder) return;
    window.api.stats.duplicates(folder.id).then(setClusters);
  }, [folder?.id, scanRevision]);

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
    <div>
      <h1>{t('duplicates.title')}</h1>
      <p className="muted">{t('duplicates.help')}</p>
      {clusters.length === 0 && <div className="empty">{t('duplicates.empty')}</div>}
      {clusters.map(c => (
        <div key={c.hash} className="card" style={{ marginBottom: 8 }}>
          <div className="muted">{t('duplicates.hash')}: {c.hash} · {c.occurrences.length.toLocaleString(locale)} {t('duplicates.occurrences')} · {c.lines.toLocaleString(locale)} {t('common.lines')}</div>
          {c.occurrences.map((o, i) => (
            <div key={i} className="mono" style={{ cursor: 'pointer' }}
                 onClick={() => {
                   saveScrollPosition();
                   navigate(`/editor/${encodeURIComponent(o.relPath)}?line=${o.startLine}`);
                 }}>
              {o.relPath}:{o.startLine}-{o.endLine}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
