import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EChartsOption } from 'echarts';
import type { FolderRow, FolderStats, ScanProgress } from '../../shared/api';
import EChartsPanel from '../components/EChartsPanel';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import { useI18n } from '../i18n';
import { escapeHtml } from '../utils/escapeHtml';

const COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#a371f7', '#79c0ff', '#56d364', '#ffa657', '#ff7b72', '#d2a8ff'];
const CHART_TEXT = '#e6edf3';
const CHART_MUTED = '#8b949e';
const CHART_BORDER = '#2a313c';
const CHART_TOOLTIP_BACKGROUND = '#161b22';

function buildLanguageShareOption(data: FolderStats['byLang'], locale: string): EChartsOption {
  return {
    color: COLORS,
    tooltip: {
      trigger: 'item',
      backgroundColor: CHART_TOOLTIP_BACKGROUND,
      borderColor: CHART_BORDER,
      textStyle: { color: CHART_TEXT },
      formatter: params => {
        const value = typeof params.value === 'number' ? params.value : Number(params.value || 0);
        return `${escapeHtml(String(params.name))}<br/>Total: ${value.toLocaleString(locale)}`;
      },
    },
    legend: {
      bottom: 0,
      left: 0,
      icon: 'circle',
      textStyle: { color: CHART_TEXT },
    },
    series: [
      {
        type: 'pie',
        radius: ['42%', '72%'],
        center: ['50%', '42%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderColor: '#111722',
          borderWidth: 2,
        },
        emphasis: {
          label: {
            show: true,
            color: CHART_TEXT,
            fontWeight: 600,
            formatter: ({ name, value }) => `${name}\n${Number(value).toLocaleString(locale)}`,
          },
        },
        label: { show: false },
        labelLine: { show: false },
        data: data.map((item, index) => ({
          name: item.lang,
          value: item.total,
          itemStyle: { color: COLORS[index % COLORS.length] },
        })),
      },
    ],
  };
}

function buildLanguageBreakdownOption(data: FolderStats['byLang'], locale: string, t: (key: string, params?: Record<string, unknown>) => string): EChartsOption {
  const labels = data.map(item => item.lang);

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: CHART_TOOLTIP_BACKGROUND,
      borderColor: CHART_BORDER,
      textStyle: { color: CHART_TEXT },
      formatter: params => {
        const points = Array.isArray(params) ? params : [params];
        return [
          escapeHtml(String(points[0]?.axisValueLabel ?? '')),
          ...points.map(point => `${point.marker}${point.seriesName}: ${Number(point.value).toLocaleString(locale)}`),
        ].join('<br/>');
      },
    },
    legend: {
      bottom: 0,
      left: 0,
      textStyle: { color: CHART_TEXT },
    },
    grid: {
      top: 16,
      right: 16,
      bottom: 48,
      left: 12,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: CHART_BORDER } },
      axisTick: { show: false },
      axisLabel: {
        color: CHART_MUTED,
        interval: 0,
        rotate: labels.length > 5 ? 28 : 0,
      },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: CHART_MUTED },
      splitLine: { lineStyle: { color: 'rgba(139, 148, 158, 0.18)' } },
    },
    series: [
      {
        name: t('common.code'),
        type: 'bar',
        barMaxWidth: 24,
        itemStyle: { color: '#58a6ff', borderRadius: [4, 4, 0, 0] },
        data: data.map(item => item.code),
      },
      {
        name: t('common.comment'),
        type: 'bar',
        barMaxWidth: 24,
        itemStyle: { color: '#d29922', borderRadius: [4, 4, 0, 0] },
        data: data.map(item => item.comment),
      },
      {
        name: t('common.blank'),
        type: 'bar',
        barMaxWidth: 24,
        itemStyle: { color: '#8b949e', borderRadius: [4, 4, 0, 0] },
        data: data.map(item => item.blank),
      },
    ],
  };
}

interface Props { folder: FolderRow | null; progress: ScanProgress | null; }

export default function Dashboard({ folder, progress }: Props) {
  const [stats, setStats] = useState<FolderStats | null>(null);
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const annotationTotal = stats ? Object.values(stats.tagCounts).reduce((sum, count) => sum + count, 0) : 0;
  const annotationBreakdown = stats
    ? Object.entries(stats.tagCounts)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => `${kind} ${count.toLocaleString(locale)}`)
      .join(' · ')
    : '';

  async function refresh() {
    if (!folder) return;
    try { setStats(await window.api.stats.summary(folder.id)); } catch { /* empty */ }
  }
  useEffect(() => { refresh(); }, [folder?.id]);
  useEffect(() => { if (progress?.phase === 'done') refresh(); }, [progress?.phase]);

  if (!folder) return (
    <EmptyState
      title={t('dashboard.title')}
      description={t('dashboard.addOrSelectFolder')}
      action={(
      <button onClick={() => navigate('/')}>{t('nav.workspace')}</button>
      )}
    />
  );

  return (
    <div className="dashboard-page">
      <PageHeader
        eyebrow={t('nav.dashboard')}
        title={folder.name}
        description={folder.rootPath}
      />

      {!stats ? <EmptyState description={t('dashboard.noData')} /> : (
        <>
          {(() => {
            const langChartData = stats.byLang.slice(0, 10);
            const languageShareOption = buildLanguageShareOption(langChartData, locale);
            const languageBreakdownOption = buildLanguageBreakdownOption(langChartData, locale, t);

            return (
              <>
          <div className="cards dashboard-cards">
            <div className="card metric-card"><div className="label">{t('common.files')}</div><div className="value">{stats.totalFiles.toLocaleString(locale)}</div></div>
            <div className="card metric-card">
              <div className="label">{t('dashboard.totalLines')}</div>
              <div className="value">{stats.totalLines.toLocaleString(locale)}</div>
            </div>
            <div className="card metric-card"><div className="label">{t('dashboard.totalCode')}</div><div className="value">{stats.totalCode.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('dashboard.runtimeCode')}</div><div className="value">{stats.runtimeCode.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('dashboard.testCode')}</div><div className="value">{stats.testCode.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('common.comments')}</div><div className="value">{stats.totalComment.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('common.blank')}</div><div className="value">{stats.totalBlank.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('dashboard.blockCommentLines')}</div><div className="value">{stats.totalBlockComment.toLocaleString(locale)}</div></div>
            <div className="card metric-card">
              <div className="label">{t('dashboard.annotations')}</div>
              <div className="value">{annotationTotal.toLocaleString(locale)}</div>
              {annotationBreakdown && <div className="metric-note">{annotationBreakdown}</div>}
            </div>
          </div>

          <h2 className="section-heading">{t('dashboard.byLanguage')}</h2>
          <div className="chart-grid dashboard-chart-grid">
            <div className="chart-box">
              <EChartsPanel option={languageShareOption} />
            </div>
            <div className="chart-box">
              <EChartsPanel option={languageBreakdownOption} />
            </div>
          </div>

          <h2 className="section-heading">{t('dashboard.languagesDetail')}</h2>
          <div className="table-wrap">
          <table>
            <thead><tr><th>{t('common.language')}</th><th>{t('common.files')}</th><th>{t('common.total')}</th><th>{t('common.code')}</th><th>{t('common.comment')}</th><th>{t('common.blank')}</th></tr></thead>
            <tbody>
              {stats.byLang.map(l => (
                <tr key={l.lang}>
                  <td>{l.lang}</td><td>{l.files.toLocaleString(locale)}</td><td>{l.total.toLocaleString(locale)}</td>
                  <td>{l.code.toLocaleString(locale)}</td><td>{l.comment.toLocaleString(locale)}</td><td>{l.blank.toLocaleString(locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
