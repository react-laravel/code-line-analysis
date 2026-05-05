import React, { useEffect, useMemo, useState } from 'react';
import type { FolderRow, HeatmapBucket } from '../../shared/api';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { useI18n } from '../i18n';
import PageHeader from '../components/PageHeader';

interface Props {
  folder: FolderRow | null;
  scanRevision: number;
  webMode: boolean;
}
type SortKey = 'date' | 'files' | 'lines';

const TOOLTIP_STYLE = { background: '#161b22', border: '1px solid #2a313c', color: '#e6edf3' };
const TOOLTIP_TEXT_STYLE = { color: '#e6edf3' };

export default function HeatmapView({ folder, scanRevision, webMode }: Props) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<HeatmapBucket[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [asc, setAsc] = useState(false);
  const { locale, t } = useI18n();

  useEffect(() => {
    if (!folder) return;
    window.api.stats.heatmap(folder.id, days).then(setData);
  }, [folder?.id, days, scanRevision]);

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      const diff = sortKey === 'date' ? a.date.localeCompare(b.date) : a[sortKey] - b[sortKey];
      return asc ? diff : -diff;
    });
  }, [asc, data, sortKey]);

  function header(nextSortKey: SortKey, label: string) {
    return (
      <th>
        <button
          className="table-sort-button"
          onClick={() => {
            if (sortKey === nextSortKey) setAsc(current => !current);
            else {
              setSortKey(nextSortKey);
              setAsc(false);
            }
          }}
        >
          {label} {sortKey === nextSortKey ? (asc ? '↑' : '↓') : ''}
        </button>
      </th>
    );
  }

  if (!folder) return <div className="empty">{t('common.selectFolder')}</div>;

  return (
    <div className="heatmap-page">
      <PageHeader
        title={t('heatmap.title')}
        description={webMode ? t('heatmap.webSubtitle') : t('heatmap.subtitle')}
        actions={(
          <label className="page-select-field">
            <span>{t('heatmap.window')}</span>
            <select value={days} onChange={e => setDays(+e.target.value)}>
              <option value={7}>{t('heatmap.days', { count: 7 })}</option>
              <option value={30}>{t('heatmap.days', { count: 30 })}</option>
              <option value={90}>{t('heatmap.days', { count: 90 })}</option>
              <option value={365}>{t('heatmap.days', { count: 365 })}</option>
            </select>
          </label>
        )}
      />
      <div className="chart-box heatmap-chart-box">
        <ResponsiveContainer>
          <BarChart data={sortedData}>
            <XAxis dataKey="date" stroke="#8b949e" />
            <YAxis stroke="#8b949e" />
            <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_TEXT_STYLE} labelStyle={TOOLTIP_TEXT_STYLE} />
            <Bar dataKey="files" fill="#58a6ff" name={t('heatmap.filesChanged')} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr>{header('date', t('common.date'))}{header('files', t('common.files'))}{header('lines', t('heatmap.totalLinesSinceDate'))}</tr></thead>
          <tbody>{sortedData.map(b => <tr key={b.date}><td>{b.date}</td><td>{b.files.toLocaleString(locale)}</td><td>{b.lines.toLocaleString(locale)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
