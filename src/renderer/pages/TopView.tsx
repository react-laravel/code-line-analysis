import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FolderRow, TopFunction } from '../../shared/api';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import { useI18n } from '../i18n';

interface Props {
  folder: FolderRow | null;
  scanRevision: number;
}

export default function TopView({ folder, scanRevision }: Props) {
  const [funcs, setFuncs] = useState<TopFunction[]>([]);
  const navigate = useNavigate();
  const { locale, t } = useI18n();

  useEffect(() => {
    if (!folder) return;
    window.api.stats.topFunctions(folder.id, 50).then(setFuncs);
  }, [folder?.id, scanRevision]);

  if (!folder) return <div className="empty">{t('common.selectFolder')}</div>;

  const longest = funcs[0]?.length ?? 0;
  const average = funcs.length > 0 ? Math.round(funcs.reduce((sum, fn) => sum + fn.length, 0) / funcs.length) : 0;

  return (
    <div className="top-page">
      <PageHeader
        title={t('top.title')}
        description={t('top.subtitle')}
      />

      {funcs.length === 0 ? <EmptyState description={t('top.noData')} /> : (
        <>
          <div className="cards top-cards">
            <div className="card metric-card">
              <div className="label">{t('top.totalFunctions')}</div>
              <div className="value">{funcs.length.toLocaleString(locale)}</div>
            </div>
            <div className="card metric-card">
              <div className="label">{t('top.longestFunction')}</div>
              <div className="value">{longest.toLocaleString(locale)}</div>
            </div>
            <div className="card metric-card">
              <div className="label">{t('top.averageLength')}</div>
              <div className="value">{average.toLocaleString(locale)}</div>
            </div>
          </div>

          <h2 className="section-heading">{t('top.longestFunctions')}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('common.file')}</th><th>{t('top.function')}</th><th>{t('top.start')}</th><th>{t('top.end')}</th><th>{t('top.length')}</th></tr></thead>
              <tbody>
                {funcs.map((f, index) => (
                  <tr
                    key={`${f.relPath}:${f.name}:${f.startLine}:${index}`}
                    className="clickable-row"
                    onClick={() => navigate(`/editor/${encodeURIComponent(f.relPath)}?line=${f.startLine}&endLine=${f.endLine}&highlight=function`)}
                  >
                    <td className="mono">{f.relPath}</td>
                    <td className="mono">{f.name}</td>
                    <td>{f.startLine.toLocaleString(locale)}</td>
                    <td>{f.endLine.toLocaleString(locale)}</td>
                    <td>{f.length.toLocaleString(locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
