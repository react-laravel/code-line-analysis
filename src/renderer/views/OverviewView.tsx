import { useCallback, useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import {
  AlignLeft,
  Code2,
  Files,
  FlaskConical,
  MessageSquareText,
  Minus,
  Play,
  RefreshCw,
  Tags,
  TextQuote,
} from 'lucide-react';
import type { FolderRow, FolderStats } from '../../shared/api';
import {
  Button,
  Chart,
  DataTable,
  EmptyState,
  Panel,
  Skeleton,
  Toolbar,
  type ChartTokens,
  type Column,
} from '../components/ui';
import NoFolderState from '../components/NoFolderState';
import ScanNowButton from '../components/ScanNowButton';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { useI18n } from '../i18n';
import { axisValueLabelOf, firstFormatterParam } from '../utils/echartsParams';
import { escapeHtml } from '../utils/escapeHtml';
import { useRevision } from '../store/app-store';
import ActivityPanel from './overview/ActivityPanel';
import { MetricGrid, MetricGridSkeleton, type OverviewMetric } from './overview/MetricGrid';

type Translator = ReturnType<typeof useI18n>['t'];
type LangRow = FolderStats['byLang'][number];

/**
 * `--ds-chart-1..8` are assigned in sequence and NEVER cycled
 * (DESIGN-SYSTEM §1.6), so the chart shows the seven largest languages plus a
 * combined "Other" slice. The table underneath still lists every language.
 */
const CHART_LANG_SLOTS = 8;

function chartLanguages(byLang: LangRow[], otherLabel: string): { rows: LangRow[]; foldedCount: number } {
  if (byLang.length <= CHART_LANG_SLOTS) return { rows: byLang, foldedCount: 0 };
  const head = byLang.slice(0, CHART_LANG_SLOTS - 1);
  const tail = byLang.slice(CHART_LANG_SLOTS - 1);
  const other = tail.reduce<LangRow>(
    (sum, row) => ({
      lang: otherLabel,
      files: sum.files + row.files,
      total: sum.total + row.total,
      code: sum.code + row.code,
      comment: sum.comment + row.comment,
      blank: sum.blank + row.blank,
    }),
    { lang: otherLabel, files: 0, total: 0, code: 0, comment: 0, blank: 0 },
  );
  return { rows: [...head, other], foldedCount: tail.length };
}

function buildLanguageShareOption(data: LangRow[], locale: string, tokens: ChartTokens): EChartsOption {
  const total = data.reduce((sum, item) => sum + item.total, 0);
  const formatPercent = (value: number) => {
    if (total <= 0) return '0%';
    const percent = (value / total) * 100;
    const fractionDigits = percent >= 10 ? 0 : percent >= 1 ? 1 : 2;
    return `${percent.toLocaleString(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })}%`;
  };

  return {
    // Slot 1 is the accent hue, so the biggest language matches the app accent.
    color: tokens.categorical,
    tooltip: {
      trigger: 'item',
      backgroundColor: tokens.tooltipBg,
      borderColor: tokens.tooltipBorder,
      textStyle: { color: tokens.ink },
      formatter: params => {
        const param = firstFormatterParam(params);
        if (!param) return '';
        const value = typeof param.value === 'number' ? param.value : Number(param.value || 0);
        return `${escapeHtml(String(param.name))}<br/>Total: ${value.toLocaleString(locale)}`;
      },
    },
    series: [
      {
        type: 'pie',
        radius: ['38%', '65%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        minShowLabelAngle: 0,
        itemStyle: {
          // 2px surface ring between touching marks (DESIGN-SYSTEM §1.6).
          borderColor: tokens.markRing,
          borderWidth: 2,
        },
        emphasis: {
          label: {
            show: true,
            color: tokens.ink,
            fontWeight: 600,
            formatter: ({ name, value }) => `${name}\n${Number(value).toLocaleString(locale)}`,
          },
        },
        label: {
          show: true,
          position: 'outside',
          alignTo: 'edge',
          edgeDistance: 12,
          bleedMargin: 4,
          color: tokens.ink,
          lineHeight: 16,
          formatter: ({ name, value }) => {
            const numericValue = Number(value);
            return `{name|${name}}\n{value|${formatPercent(numericValue)} · ${numericValue.toLocaleString(locale)}}`;
          },
          rich: {
            name: {
              color: tokens.ink,
              fontSize: 11,
              fontWeight: 600,
            },
            value: {
              color: tokens.inkMuted,
              fontSize: 10,
            },
          },
        },
        labelLine: {
          show: true,
          length: 10,
          length2: 8,
          smooth: 0.2,
          lineStyle: {
            color: tokens.inkMuted,
            width: 1,
          },
        },
        labelLayout: {
          moveOverlap: 'shiftY',
        },
        data: data.map(item => ({ name: item.lang, value: item.total })),
      },
    ],
  };
}

function buildLanguageBreakdownOption(
  data: LangRow[],
  locale: string,
  t: Translator,
  tokens: ChartTokens,
): EChartsOption {
  const labels = data.map(item => item.lang);
  const [code, comment, blank] = tokens.categorical;

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: tokens.tooltipBg,
      borderColor: tokens.tooltipBorder,
      textStyle: { color: tokens.ink },
      formatter: params => {
        const points = Array.isArray(params) ? params : [params];
        return [
          escapeHtml(axisValueLabelOf(points[0])),
          ...points.map(point => `${point.marker}${point.seriesName}: ${Number(point.value).toLocaleString(locale)}`),
        ].join('<br/>');
      },
    },
    legend: {
      bottom: 0,
      left: 0,
      textStyle: { color: tokens.ink },
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
      axisLine: { lineStyle: { color: tokens.axis } },
      axisTick: { show: false },
      axisLabel: {
        color: tokens.inkMuted,
        interval: 0,
        rotate: labels.length > 5 ? 28 : 0,
      },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: tokens.inkMuted },
      splitLine: { lineStyle: { color: tokens.grid } },
    },
    // Stacked: the three parts sum to the language's total line count, and a
    // 2px surface gap separates the segments (DESIGN-SYSTEM §1.6 mark specs).
    series: [
      {
        name: t('common.code'),
        type: 'bar',
        stack: 'lines',
        barMaxWidth: 28,
        itemStyle: { color: code, borderColor: tokens.markRing, borderWidth: 1 },
        data: data.map(item => item.code),
      },
      {
        name: t('common.comment'),
        type: 'bar',
        stack: 'lines',
        barMaxWidth: 28,
        itemStyle: { color: comment, borderColor: tokens.markRing, borderWidth: 1 },
        data: data.map(item => item.comment),
      },
      {
        name: t('common.blank'),
        type: 'bar',
        stack: 'lines',
        barMaxWidth: 28,
        // Only the top segment is rounded — the stack stays square at the baseline.
        itemStyle: { color: blank, borderRadius: [4, 4, 0, 0], borderColor: tokens.markRing, borderWidth: 1 },
        data: data.map(item => item.blank),
      },
    ],
  };
}

interface Props {
  folder: FolderRow | null;
}

/**
 * `⌘1` — the merge of the old `/dashboard` and `/heatmap` routes (blueprint
 * §2.2). Three hero metrics, a secondary tile row, one "By language" `Panel`
 * whose donut ships the per-language table as its relief channel
 * (DESIGN-SYSTEM §1.6 makes that mandatory: aqua/yellow/magenta are sub-3:1
 * on a light surface), and the Activity panel that used to be a whole route.
 */
export default function OverviewView({ folder }: Props) {
  const scanRevision = useRevision();
  const { locale, t } = useI18n();

  const folderId = folder?.id ?? null;
  const loadStats = useCallback(
    () => folderId == null ? Promise.reject(new Error('No active folder')) : window.api.stats.summary(folderId),
    [folderId],
  );
  const {
    data: stats,
    loading,
    error,
    reload,
  } = useAsyncResource<FolderStats | null>({
    resourceKey: folderId,
    refreshToken: scanRevision,
    initialData: null,
    load: loadStats,
  });

  const languageTotal = stats?.totalLines ?? 0;
  const languageColumns = useMemo<Column<LangRow>[]>(() => [
    { id: 'lang', header: t('common.language'), cell: row => row.lang },
    {
      id: 'share',
      header: t('overview.share'),
      width: 128,
      truncate: false,
      cell: row => {
        const percent = languageTotal > 0 ? (row.total / languageTotal) * 100 : 0;
        const label = `${percent.toLocaleString(locale, {
          minimumFractionDigits: percent >= 10 ? 0 : 1,
          maximumFractionDigits: percent >= 10 ? 0 : 1,
        })}%`;
        return (
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-inset">
              <span
                className="block h-full rounded-full bg-accent"
                style={{ width: `${Math.min(100, percent)}%` }}
              />
            </span>
            <span className="ds-tabular min-w-8 text-right text-2xs text-fg-muted">{label}</span>
          </span>
        );
      },
    },
    { id: 'files', header: t('common.files'), align: 'right', cell: row => row.files.toLocaleString(locale) },
    { id: 'total', header: t('common.total'), align: 'right', cell: row => row.total.toLocaleString(locale) },
    { id: 'code', header: t('common.code'), align: 'right', cell: row => row.code.toLocaleString(locale) },
    { id: 'comment', header: t('common.comment'), align: 'right', cell: row => row.comment.toLocaleString(locale) },
    { id: 'blank', header: t('common.blank'), align: 'right', cell: row => row.blank.toLocaleString(locale) },
  ], [languageTotal, locale, t]);

  const { rows: chartRows, foldedCount } = useMemo(
    () => chartLanguages(stats?.byLang ?? [], t('common.other')),
    [stats, t],
  );

  const shareOption = useCallback(
    (tokens: ChartTokens) => buildLanguageShareOption(chartRows, locale, tokens),
    [chartRows, locale],
  );
  const breakdownOption = useCallback(
    (tokens: ChartTokens) => buildLanguageBreakdownOption(chartRows, locale, t, tokens),
    [chartRows, locale, t],
  );

  const metrics = useMemo<OverviewMetric[]>(() => {
    if (!stats) return [];
    const annotationTotal = Object.values(stats.tagCounts).reduce((sum, count) => sum + count, 0);
    const annotationBreakdown = Object.entries(stats.tagCounts)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => `${kind} ${count.toLocaleString(locale)}`)
      .join(' · ');
    return [
      { id: 'files', size: 'md', icon: Files, label: t('common.files'), value: stats.totalFiles.toLocaleString(locale) },
      { id: 'lines', size: 'md', icon: AlignLeft, label: t('dashboard.totalLines'), value: stats.totalLines.toLocaleString(locale) },
      {
        id: 'code',
        size: 'md',
        icon: Code2,
        label: t('dashboard.totalCode'),
        value: stats.totalCode.toLocaleString(locale),
        className: 'col-span-2 min-[720px]:col-span-1',
      },
      { id: 'runtime', icon: Play, label: t('dashboard.runtimeCode'), value: stats.runtimeCode.toLocaleString(locale) },
      { id: 'test', icon: FlaskConical, label: t('dashboard.testCode'), value: stats.testCode.toLocaleString(locale) },
      { id: 'comments', icon: MessageSquareText, label: t('common.comments'), value: stats.totalComment.toLocaleString(locale) },
      { id: 'blank', icon: Minus, label: t('common.blank'), value: stats.totalBlank.toLocaleString(locale) },
      { id: 'block', icon: TextQuote, label: t('dashboard.blockCommentLines'), value: stats.totalBlockComment.toLocaleString(locale) },
      {
        id: 'annotations',
        icon: Tags,
        label: t('dashboard.annotations'),
        value: annotationTotal.toLocaleString(locale),
        hint: annotationBreakdown || undefined,
      },
    ];
  }, [locale, stats, t]);

  if (!folder) return <NoFolderState />;

  const languagesTable = (
    <div className="min-w-0">
      <h3 className="mt-1 mb-1.5 text-xs font-medium text-fg-muted">{t('dashboard.languagesDetail')}</h3>
      <DataTable
        aria-label={t('dashboard.languagesDetail')}
        columns={languageColumns}
        rows={stats?.byLang ?? []}
        rowKey={row => row.lang}
      />
      {foldedCount > 0 ? (
        <p className="mt-1.5 mb-0 text-xs text-fg-subtle">
          {t('overview.otherLanguages', { count: foldedCount })}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="grid gap-4">
      <Toolbar
        sticky={false}
        title={t('nav.overview')}
        subtitle={`${folder.name} · ${folder.rootPath}`}
        className="rounded-lg border border-border"
      />

      {error ? (
        <EmptyState
          variant="error"
          title={t('common.loadFailed')}
          description={t('overview.loadFailedHelp')}
          error={error}
          action={(
            <Button variant="primary" icon={RefreshCw} onClick={reload}>
              {t('common.retry')}
            </Button>
          )}
        />
      ) : loading && !stats ? (
        <>
          <MetricGridSkeleton />
          <div className="grid gap-3 min-[900px]:grid-cols-2">
            <Skeleton variant="tile" className="h-64" />
            <Skeleton variant="tile" className="h-64" />
          </div>
        </>
      ) : !stats ? (
        <EmptyState
          title={t('common.noData')}
          description={t('dashboard.noData')}
          action={<ScanNowButton folderId={folder.id} disabled={!folder.isAvailable} />}
        />
      ) : (
        <>
          <MetricGrid metrics={metrics} />

          <Panel header={t('dashboard.byLanguage')}>
            {/* The donut figure is `display: contents`, so its chart area and its
                `tableFallback` become grid items: charts on row 1, the relief
                table spanning row 2 — exactly the layout blueprint §2.2 draws. */}
            <div className="grid items-start gap-3 min-[900px]:grid-cols-2">
              <Chart
                className="contents"
                option={shareOption}
                height={256}
                ariaLabel={t('overview.languageShare')}
                tableFallback={<div className="order-3 min-w-0 min-[900px]:col-span-2">{languagesTable}</div>}
              />
              <Chart
                className="order-2 min-w-0 min-[900px]:col-start-2 min-[900px]:row-start-1"
                option={breakdownOption}
                height={256}
                ariaLabel={t('overview.languageBreakdown')}
              />
            </div>
          </Panel>
        </>
      )}

      {error ? null : <ActivityPanel folder={folder} />}
    </div>
  );
}
