import { useCallback, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { useNavigate } from 'react-router-dom';
import type { FileRelationGraph, FileRelationNode } from '../../../shared/api';
import {
  Badge,
  Chart,
  Checkbox,
  DataTable,
  EmptyState,
  Panel,
  Select,
  Spinner,
  type ChartTokens,
  type Column,
} from '../../components/ui';
import PathCell from '../../components/PathCell';
import ScanNowButton from '../../components/ScanNowButton';
import { splitRelPath } from '../../lib/path';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { useI18n } from '../../i18n';
import { firstFormatterParam } from '../../utils/echartsParams';
import { escapeHtml } from '../../utils/escapeHtml';
import { useRevision } from '../../store/app-store';
import {
  ArchMetrics,
  ArchMetricsText,
  useGraphMenu,
  type ArchLens,
  type ArchLensArgs,
  type ArchMetric,
  type ChartEvents,
} from './lens';

const DEFAULT_VISIBLE_NODES = 40;
const MAX_TABLE_ROWS = 30;
/**
 * DESIGN-SYSTEM §1.6: an all-pairs form caps at categorical slots 1–3, so only
 * the three largest top-level directories keep a hue and everything past them
 * folds into one neutral "Other" category.
 */
const CATEGORICAL_SLOTS = 3;
const EMPTY_GRAPH: FileRelationGraph = {
  nodes: [],
  edges: [],
  scannedFiles: 0,
  connectedFiles: 0,
  unresolvedCount: 0,
};

function nodeScore(node: FileRelationNode): number {
  return (node.incoming * 2) + node.outgoing + Math.min(12, Math.round(node.code / 120));
}

function getVisibleGraph(graph: FileRelationGraph, limit: number) {
  const rankedNodes = [...graph.nodes].sort((left, right) => nodeScore(right) - nodeScore(left) || right.code - left.code || left.relPath.localeCompare(right.relPath));
  const visibleIds = new Set(rankedNodes.slice(0, limit).map(node => node.id));

  return {
    nodes: graph.nodes.filter(node => visibleIds.has(node.id)),
    edges: graph.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
  };
}

/**
 * The Imports lens (was `/relations`). The node-count `Select` and the label
 * toggle move into the toolbar's filters row; the "Most Connected Files" table
 * stays underneath as the graph's relief channel (DESIGN-SYSTEM §1.6).
 */
export function useImportsLens({ folder, active }: ArchLensArgs): ArchLens {
  const revision = useRevision();
  const { locale, t } = useI18n();
  const navigate = useNavigate();

  const [visibleNodeLimit, setVisibleNodeLimit] = useState(DEFAULT_VISIBLE_NODES);
  const [showAllLabels, setShowAllLabels] = useState(false);

  const folderId = folder.id;
  const loadGraph = useCallback(() => window.api.stats.fileRelations(folderId), [folderId]);
  const graphErrorData = useCallback(() => EMPTY_GRAPH, []);
  const { data: graph, loading } = useAsyncResource<FileRelationGraph | null>({
    resourceKey: folderId,
    refreshToken: revision,
    enabled: active,
    initialData: null,
    load: loadGraph,
    errorData: graphErrorData,
  });

  const visibleGraph = useMemo(
    () => (graph ? getVisibleGraph(graph, visibleNodeLimit) : { nodes: [], edges: [] }),
    [graph, visibleNodeLimit],
  );

  const topConnectedFiles = useMemo(
    () => [...(graph?.nodes ?? [])]
      .sort((left, right) => nodeScore(right) - nodeScore(left) || right.code - left.code)
      .slice(0, MAX_TABLE_ROWS),
    [graph],
  );

  const topConnectedColumns = useMemo<Column<FileRelationNode>[]>(() => [
    { id: 'relPath', header: t('common.file'), width: 260, cell: node => <PathCell path={node.relPath} /> },
    { id: 'lang', header: t('common.language'), cell: node => <Badge size="xs">{node.lang}</Badge> },
    { id: 'incoming', header: t('relations.incoming'), align: 'right', cell: node => node.incoming.toLocaleString(locale) },
    { id: 'outgoing', header: t('relations.outgoing'), align: 'right', cell: node => node.outgoing.toLocaleString(locale) },
    { id: 'code', header: t('common.code'), align: 'right', cell: node => node.code.toLocaleString(locale) },
  ], [locale, t]);

  const resetFilters = useCallback(() => {
    setVisibleNodeLimit(DEFAULT_VISIBLE_NODES);
    setShowAllLabels(false);
  }, []);

  const chartEvents = useMemo<ChartEvents>(() => ({
    click: params => {
      const relPath = typeof params === 'object' && params && 'dataType' in params && params.dataType === 'node'
        && 'data' in params && typeof params.data === 'object' && params.data && 'relPath' in params.data
        ? String(params.data.relPath)
        : null;
      if (relPath) navigate(`/editor/${encodeURIComponent(relPath)}`);
    },
  }), [navigate]);

  const menu = useGraphMenu({
    graph: true,
    fileName: 'imports',
    data: useCallback(() => visibleGraph, [visibleGraph]),
    onReset: resetFilters,
    resetDisabled: visibleNodeLimit === DEFAULT_VISIBLE_NODES && !showAllLabels,
    chartEvents,
  });

  const seed = menu.seed;

  const chartOption = useCallback((tokens: ChartTokens): EChartsOption => {
    const groupCounts = new Map<string, number>();
    visibleGraph.nodes.forEach(node => groupCounts.set(node.group, (groupCounts.get(node.group) ?? 0) + 1));
    const orderedGroups = Array.from(groupCounts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([group]) => group);

    // Slots 1-3 by size; everything else shares one neutral "Other" category.
    const primaryGroups = orderedGroups.slice(0, CATEGORICAL_SLOTS);
    const hasOther = orderedGroups.length > CATEGORICAL_SLOTS;
    const groupIndex = new Map(primaryGroups.map((group, index) => [group, index]));
    const categoryNames = hasOther ? [...primaryGroups, t('common.other')] : primaryGroups;
    const palette = hasOther
      ? [...tokens.categorical.slice(0, CATEGORICAL_SLOTS), tokens.inkMuted]
      : tokens.categorical.slice(0, CATEGORICAL_SLOTS);

    const prominentIds = new Set(
      [...visibleGraph.nodes]
        .sort((left, right) => nodeScore(right) - nodeScore(left) || right.code - left.code)
        .slice(0, showAllLabels ? visibleGraph.nodes.length : 10)
        .map(node => node.id),
    );

    return {
      animationDuration: 700,
      color: palette,
      legend: categoryNames.length > 1 ? {
        bottom: 0,
        left: 0,
        textStyle: { color: tokens.ink },
        data: categoryNames,
      } : undefined,
      tooltip: {
        backgroundColor: tokens.tooltipBg,
        borderColor: tokens.tooltipBorder,
        textStyle: { color: tokens.ink },
        formatter: params => {
          const param = firstFormatterParam(params);
          if (!param) return '';
          if (param.dataType === 'edge') {
            const edge = param.data as { source?: unknown; target?: unknown };
            return `${escapeHtml(String(edge.source))}<br/>→ ${escapeHtml(String(edge.target))}`;
          }

          const data = param.data as {
            relPath: string;
            lang: string;
            code: number;
            incoming: number;
            outgoing: number;
          };
          return [
            escapeHtml(data.relPath),
            `${t('common.language')}: ${escapeHtml(data.lang)}`,
            `${t('common.code')}: ${Number(data.code).toLocaleString(locale)}`,
            `${t('relations.incoming')}: ${Number(data.incoming).toLocaleString(locale)}`,
            `${t('relations.outgoing')}: ${Number(data.outgoing).toLocaleString(locale)}`,
          ].join('<br/>');
        },
      },
      series: [
        {
          id: `imports-graph-${seed}`,
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          scaleLimit: { min: 0.45, max: 3 },
          edgeSymbol: ['none', 'arrow'],
          edgeSymbolSize: [0, 5],
          emphasis: {
            focus: 'adjacency',
            label: { show: true, color: tokens.ink, fontWeight: 600 },
            lineStyle: { opacity: 0.9, width: 2.2 },
          },
          blur: {
            itemStyle: { opacity: 0.18 },
            lineStyle: { opacity: 0.025 },
            label: { show: false },
          },
          force: {
            repulsion: 460,
            gravity: 0.025,
            edgeLength: [72, 170],
            friction: 0.28,
          },
          lineStyle: {
            color: 'source',
            curveness: 0.12,
            opacity: 0.2,
            width: 1,
          },
          labelLayout: { hideOverlap: true },
          categories: categoryNames.map(group => ({ name: group })),
          data: visibleGraph.nodes.map(node => ({
            id: node.id,
            name: splitRelPath(node.relPath).name,
            relPath: node.relPath,
            lang: node.lang,
            code: node.code,
            incoming: node.incoming,
            outgoing: node.outgoing,
            category: groupIndex.get(node.group) ?? (hasOther ? CATEGORICAL_SLOTS : 0),
            symbolSize: 12 + Math.min(25, Math.sqrt((node.incoming + node.outgoing) * 14 + Math.max(node.code, 1) / 24)),
            // Test files carry a shape difference AND a ring, never colour
            // alone (DESIGN-SYSTEM §0 rule 2); the ring is the shared
            // `--ds-chart-mark-ring`, not a hardcoded amber. The key for it is
            // rendered as DOM below the chart.
            symbol: node.isTest ? 'diamond' : 'circle',
            itemStyle: node.isTest ? { borderColor: tokens.markRing, borderWidth: 2 } : undefined,
            label: prominentIds.has(node.id)
              ? { show: true, color: tokens.ink, formatter: splitRelPath(node.relPath).name, overflow: 'truncate', width: 120 }
              : { show: false },
          })),
          links: visibleGraph.edges.map(edge => ({
            source: edge.source,
            target: edge.target,
            value: edge.value,
            lineStyle: { width: 0.8 + Math.min(2.2, edge.value * 0.6), opacity: 0.2, curveness: 0.12 },
          })),
        },
      ],
      textStyle: { color: tokens.inkMuted },
    };
  }, [locale, seed, showAllLabels, t, visibleGraph]);

  const metrics: ArchMetric[] = graph
    ? [
      { label: t('relations.scannedFiles'), value: graph.scannedFiles.toLocaleString(locale) },
      { label: t('relations.connectedFiles'), value: graph.connectedFiles.toLocaleString(locale) },
      { label: t('relations.links'), value: graph.edges.length.toLocaleString(locale) },
      { label: t('relations.unresolved'), value: graph.unresolvedCount.toLocaleString(locale) },
    ]
    : [];

  const filters = (
    <>
      <span className="text-xs text-fg-muted">{t('relations.nodeCount')}</span>
      <Select
        size="sm"
        wrapperClassName="w-28"
        aria-label={t('relations.nodeCount')}
        value={String(visibleNodeLimit)}
        onChange={event => setVisibleNodeLimit(Number(event.target.value))}
        options={[30, 40, 50, 80].map(value => ({ value: String(value), label: String(value) }))}
      />
      <Checkbox
        size="sm"
        checked={showAllLabels}
        onChange={event => setShowAllLabels(event.target.checked)}
        label={t('relations.allLabels')}
      />
    </>
  );

  const content = (
    <div className="grid gap-4">
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-10">
          <Spinner size="md" label={t('relations.loading')} />
        </div>
      ) : null}

      {!loading && graph && graph.connectedFiles === 0 ? (
        <EmptyState
          title={t('common.noData')}
          description={t('relations.noData')}
          action={<ScanNowButton folderId={folderId} disabled={!folder.isAvailable} />}
        />
      ) : null}

      {!loading && graph && graph.connectedFiles > 0 ? (
        <>
          <ArchMetrics items={metrics} />

          <Panel className="overflow-hidden">
            <Chart
              option={chartOption}
              ariaLabel={t('relations.title')}
              height={556}
              onEvents={menu.onEvents}
            />
          </Panel>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-fg-muted">
            <span>{t('relations.clickHint')}</span>
            {/* The test-file marker's key: shape first, ring second — the pair
                that replaced the hardcoded amber node colour. */}
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block size-2 rotate-45 border-2 border-[var(--ds-chart-mark-ring)]"
              />
              {t('relations.testFile')}
            </span>
          </div>

          <h2 className="mt-2 mb-0 text-base font-medium text-fg">{t('relations.topConnected')}</h2>
          <DataTable
            aria-label={t('relations.topConnected')}
            columns={topConnectedColumns}
            rows={topConnectedFiles}
            rowKey={node => node.id}
            onRowActivate={node => navigate(`/editor/${encodeURIComponent(node.relPath)}`)}
          />
        </>
      ) : null}
    </div>
  );

  return {
    count: graph?.connectedFiles,
    filters,
    overflow: menu.items,
    subtitle: (
      <>
        {graph
          ? t('relations.visibleGraph', { visible: visibleGraph.nodes.length, total: graph.connectedFiles })
          : t('relations.subtitle')}
        {' '}
        <ArchMetricsText items={metrics} />
      </>
    ),
    content,
  };
}
