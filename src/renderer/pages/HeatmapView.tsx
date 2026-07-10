import React, { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import type { FolderRow, HeatmapBucket } from '../../shared/api';
import EChartsPanel from '../components/EChartsPanel';
import { useI18n } from '../i18n';
import PageHeader from '../components/PageHeader';
import { escapeHtml } from '../utils/escapeHtml';

interface Props {
  folder: FolderRow | null;
  scanRevision: number;
  webMode: boolean;
}
type SortKey = 'date' | 'files' | 'lines';

const CHART_TEXT = '#e6edf3';
const CHART_MUTED = '#8b949e';
const CHART_BORDER = '#2a313c';
const CHART_TOOLTIP_BACKGROUND = '#161b22';

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

  const chartData = useMemo(
    () => [...data].sort((left, right) => left.date.localeCompare(right.date)),
    [data],
  );

  const chartOption = useMemo<EChartsOption>(() => ({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: CHART_TOOLTIP_BACKGROUND,
      borderColor: CHART_BORDER,
      textStyle: { color: CHART_TEXT },
      formatter: params => {
        const point = Array.isArray(params) ? params[0] : params;
        const lines = point && typeof point.data === 'object' && point.data && 'lines' in point.data
          ? Number(point.data.lines)
          : 0;
        return [
          escapeHtml(String(point?.axisValueLabel ?? '')),
          `${t('heatmap.filesChanged')}: ${Number(point?.value ?? 0).toLocaleString(locale)}`,
          `${t('heatmap.totalLinesSinceDate')}: ${lines.toLocaleString(locale)}`,
        ].join('<br/>');
      },
    },
    grid: {
      top: 16,
      right: 16,
      bottom: chartData.length > 10 ? 68 : 44,
      left: 12,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: chartData.map(bucket => bucket.date),
      axisLine: { lineStyle: { color: CHART_BORDER } },
      axisTick: { show: false },
      axisLabel: {
        color: CHART_MUTED,
        interval: 0,
        rotate: chartData.length > 10 ? 38 : 0,
      },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: CHART_MUTED },
      splitLine: { lineStyle: { color: 'rgba(139, 148, 158, 0.18)' } },
    },
    series: [
      {
        name: t('heatmap.filesChanged'),
        type: 'bar',
        barMaxWidth: 32,
        itemStyle: { color: '#58a6ff', borderRadius: [4, 4, 0, 0] },
        data: chartData.map(bucket => ({ value: bucket.files, lines: bucket.lines })),
      },
    ],
  }), [chartData, locale, t]);

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
        <EChartsPanel option={chartOption} />
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
