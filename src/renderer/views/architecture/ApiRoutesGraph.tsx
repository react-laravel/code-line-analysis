import { useCallback } from 'react';
import type { EChartsOption } from 'echarts';
import { color } from 'echarts/core';
import { Chart, type ChartTokens } from '../../components/ui/chart';
import { Panel } from '../../components/ui/panel';
import { escapeHtml } from '../../utils/escapeHtml';
import type { ChartEvents } from './lens';
import {
  methodLabel,
  routeChartVariantLabel,
  ROUTE_METHOD_ORDER,
  VISIBLE_ANALYSIS_GROUPS,
  type RouteAnalysisChart,
  type RouteChartVariant,
  type RouteFlowGraph,
  type RouteFlowNode,
  type RouteHierarchyChart,
  type RouteHierarchyNode,
  type RouteNodeKind,
  type Translate,
} from './routes-model';

/**
 * Route comparisons and relationships in the toolbar's "View as ▾" menu.
 *
 * Every colour comes from `ChartTokens`; the file's old `FRAMEWORK_COLORS` /
 * `METHOD_COLORS` / `CHART_TEXT` / `CHART_MUTED` / `CHART_BORDER` /
 * `CHART_TOOLTIP_BACKGROUND` literals are gone, which is what lets the charts
 * follow the theme instead of being re-skinned by a string-substitution pass.
 *
 * Encoding (DESIGN-SYSTEM §1.6):
 * - force / sankey use categorical slots by node kind, capped at
 *   categorical slots 1–3 — one per node kind (framework · path prefix ·
 *   method), which is exactly the graph's own category model.
 * - treemap encodes *depth*, an ordered variable, so it uses
 *   the ordinal ramp.
 * - heatmap is a continuous magnitude: the sequential ramp via `visualMap`.
 * - stacked bar is the one categorical-by-series form; its methods take the
 *   fixed method slots and anything past slot 8 falls back to the
 *   muted ink so nothing is ever cycled.
 */

const KIND_SLOT: Record<RouteNodeKind, number> = { root: 0, framework: 0, group: 1, method: 2 };
const KIND_DEPTH: Record<RouteNodeKind, number> = { root: 0, framework: 1, group: 2, method: 3 };

export interface RouteChartContext {
  variant: RouteChartVariant;
  flow: RouteFlowGraph;
  hierarchy: RouteHierarchyChart;
  analysis: RouteAnalysisChart;
  locale: string;
  t: Translate;
  /** Changes on "Re-layout graph" so the series is rebuilt from scratch. */
  seed: number;
}

function tooltipChrome(tokens: ChartTokens) {
  return {
    backgroundColor: tokens.tooltipBg,
    borderColor: tokens.tooltipBorder,
    textStyle: { color: tokens.ink },
  };
}

function methodSlot(method: string, tokens: ChartTokens): string {
  return tokens.categorical[ROUTE_METHOD_ORDER.indexOf(method)] ?? tokens.inkMuted;
}

function markLabelColor(background: string, tokens: ChartTokens): string {
  const luminance = (value: string): number => {
    const rgb = color.parse(value) ?? [0, 0, 0];
    const linear = rgb.slice(0, 3).map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const fill = luminance(background);
  const contrast = (text: string): number => {
    const ink = luminance(text);
    return (Math.max(fill, ink) + 0.05) / (Math.min(fill, ink) + 0.05);
  };
  return contrast(tokens.surface) > contrast(tokens.ink) ? tokens.surface : tokens.ink;
}

function nodeTooltip(data: RouteFlowNode, ctx: RouteChartContext): string {
  const { locale, t } = ctx;
  const lines = [
    escapeHtml(data.displayName),
    `${t('apiRoutes.routes')}: ${data.routeCount.toLocaleString(locale)}`,
  ];

  if (data.methodCount != null && data.methodCount !== data.routeCount) {
    lines.push(`${t('apiRoutes.methodMatches')}: ${data.methodCount.toLocaleString(locale)}`);
  }

  if (data.kind === 'group') {
    lines.push(`${t('apiRoutes.depth')}: ${ctx.flow.groupDepth.toLocaleString(locale)}`);
    lines.push(`${t('common.files')}: ${Number(data.sourceCount ?? 0).toLocaleString(locale)}`);
    if (data.methods && data.methods.length > 0) {
      lines.push(`${t('apiRoutes.methods')}: ${data.methods.map(method => escapeHtml(methodLabel(method, t))).join(' / ')}`);
    }
  }

  if (data.kind === 'method' && data.method) lines.push(`${t('apiRoutes.methods')}: ${escapeHtml(methodLabel(data.method, t))}`);

  return lines.join('<br/>');
}

/** Shared formatter for graph, sankey and treemap nodes. */
function structureFormatter(ctx: RouteChartContext) {
  return (params: unknown): string => {
    if (typeof params !== 'object' || !params) return '';
    const payload = params as { dataType?: string; value?: number; data?: RouteFlowNode };
    if (payload.dataType === 'edge') {
      return `${ctx.t('apiRoutes.methodMatches')}: ${Number(payload.value ?? 0).toLocaleString(ctx.locale)}`;
    }
    const data = payload.data;
    if (!data || typeof data.displayName !== 'string') return '';
    return nodeTooltip(data, ctx);
  };
}

function decorateFlowNode(node: RouteFlowNode, tokens: ChartTokens) {
  return {
    ...node,
    itemStyle: {
      color: tokens.categorical[KIND_SLOT[node.kind]],
      borderColor: tokens.markRing,
      borderWidth: node.kind === 'framework' ? 2 : 1.5,
    },
    label: {
      show: true,
      color: tokens.ink,
      fontSize: node.kind === 'framework' ? 13 : 11,
      fontWeight: node.kind === 'framework' ? 600 : 400,
      formatter: node.displayName,
    },
    emphasis: {
      scale: true,
      itemStyle: { borderColor: tokens.markRing, borderWidth: 2.5 },
      label: { show: true },
    },
  };
}

type DecoratedHierarchyNode = Omit<RouteHierarchyNode, 'children'> & {
  itemStyle: { color: string; borderColor: string; borderWidth: number };
  label: { color: string; fontSize: number; fontWeight: number; formatter: string };
  children?: DecoratedHierarchyNode[];
};

function decorateHierarchyNode(node: RouteHierarchyNode, tokens: ChartTokens, locale: string): DecoratedHierarchyNode {
  const depth = KIND_DEPTH[node.kind];
  const fill = tokens.ordinal[Math.min(depth, tokens.ordinal.length - 1)];
  return {
    ...node,
    itemStyle: {
      color: fill,
      borderColor: tokens.surface,
      borderWidth: 2,
    },
    label: {
      color: markLabelColor(fill, tokens),
      fontSize: node.kind === 'framework' ? 13 : 11,
      fontWeight: node.kind === 'framework' ? 600 : 400,
      formatter: `${node.displayName}\n${node.routeCount.toLocaleString(locale)}`,
    },
    children: node.children?.map(child => decorateHierarchyNode(child, tokens, locale)),
  };
}

export function routeChartOption(tokens: ChartTokens, ctx: RouteChartContext): EChartsOption {
  const { analysis, flow, hierarchy, locale, seed, t, variant } = ctx;
  const base = {
    animation: true,
    animationDuration: 450,
    animationDurationUpdate: 320,
    textStyle: { color: tokens.inkMuted },
  } as const;
  const scrollRows = analysis.groups.length > VISIBLE_ANALYSIS_GROUPS;
  const rowZoom = (top: number, bottom: number): EChartsOption['dataZoom'] => scrollRows ? [
    {
      type: 'slider', yAxisIndex: 0, filterMode: 'filter',
      startValue: 0, endValue: VISIBLE_ANALYSIS_GROUPS - 1,
      right: 4, top, bottom, width: 12,
      zoomLock: true, brushSelect: false, showDetail: false,
    },
    {
      type: 'inside', yAxisIndex: 0, filterMode: 'filter',
      startValue: 0, endValue: VISIBLE_ANALYSIS_GROUPS - 1,
      zoomLock: true, zoomOnMouseWheel: false, moveOnMouseWheel: true,
    },
  ] : [];

  if (variant === 'heatmap') {
    return {
      ...base,
      tooltip: {
        trigger: 'item',
        ...tooltipChrome(tokens),
        formatter: params => {
          const data = typeof params === 'object' && params && 'data' in params ? params.data as {
            value: [number, number, number];
            displayName: string;
            routeCount: number;
            sourceCount: number;
            method: string;
          } : null;
          if (!data) return '';
          return [
            escapeHtml(data.displayName),
            `${t('apiRoutes.methods')}: ${escapeHtml(methodLabel(data.method, t))}`,
            `${t('apiRoutes.methodMatches')}: ${Number(data.value?.[2] ?? 0).toLocaleString(locale)}`,
            `${t('apiRoutes.routes')}: ${data.routeCount.toLocaleString(locale)}`,
            `${t('common.files')}: ${data.sourceCount.toLocaleString(locale)}`,
          ].join('<br/>');
        },
      },
      visualMap: {
        min: 0,
        max: Math.max(1, analysis.maxValue),
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        textStyle: { color: tokens.inkMuted },
        inRange: { color: tokens.sequential },
      },
      dataZoom: rowZoom(18, 84),
      grid: { top: 18, left: 16, right: scrollRows ? 36 : 18, bottom: 84, containLabel: true },
      xAxis: {
        type: 'category',
        data: analysis.methods.map(method => methodLabel(method, t)),
        splitArea: { show: true },
        axisLabel: { color: tokens.inkMuted },
        axisLine: { lineStyle: { color: tokens.axis } },
      },
      yAxis: {
        type: 'category',
        data: analysis.groups.map(group => group.displayName),
        splitArea: { show: true },
        axisLabel: { color: tokens.inkMuted, width: 180, overflow: 'truncate', interval: 0 },
        axisLine: { lineStyle: { color: tokens.axis } },
        inverse: true,
      },
      series: [
        {
          id: `routes-heatmap-${seed}`,
          type: 'heatmap',
          data: analysis.groups.flatMap((group, groupIndex) => analysis.methods.map((method, methodIndex) => ({
            value: [methodIndex, groupIndex, group.methodCounts[method] ?? 0] as [number, number, number],
            displayName: group.label,
            kind: 'group',
            framework: group.framework,
            routeCount: group.routeCount,
            sourceCount: group.sourceCount,
            method,
            label: {
              color: markLabelColor(color.lerp((group.methodCounts[method] ?? 0) / Math.max(1, analysis.maxValue), tokens.sequential), tokens),
            },
          }))),
          label: {
            show: true,
            color: tokens.ink,
            formatter: params => {
              const value = typeof params === 'object' && params && 'data' in params
                ? (params.data as { value: [number, number, number] }).value?.[2]
                : null;
              return Number(value ?? 0) > 0 ? String(value) : '';
            },
          },
          itemStyle: { borderColor: tokens.surface, borderWidth: 2 },
        },
      ],
    };
  }

  if (variant === 'stackedBar') {
    return {
      ...base,
      tooltip: {
        trigger: 'item',
        ...tooltipChrome(tokens),
        formatter: params => {
          const data = typeof params === 'object' && params && 'data' in params ? params.data as {
            value: number;
            displayName: string;
            routeCount: number;
            sourceCount: number;
            method: string;
          } : null;
          if (!data) return '';
          return [
            escapeHtml(data.displayName),
            `${t('apiRoutes.methods')}: ${escapeHtml(methodLabel(data.method, t))}`,
            `${t('apiRoutes.methodMatches')}: ${Number(data.value ?? 0).toLocaleString(locale)}`,
            `${t('apiRoutes.routes')}: ${data.routeCount.toLocaleString(locale)}`,
            `${t('common.files')}: ${data.sourceCount.toLocaleString(locale)}`,
          ].join('<br/>');
        },
      },
      legend: { type: 'scroll', top: 0, textStyle: { color: tokens.inkMuted } },
      dataZoom: rowZoom(56, 24),
      grid: { top: 56, left: 16, right: scrollRows ? 36 : 18, bottom: 24, containLabel: true },
      xAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: tokens.inkMuted },
        splitLine: { lineStyle: { color: tokens.grid } },
      },
      yAxis: {
        type: 'category',
        data: analysis.groups.map(group => group.displayName),
        axisLabel: { color: tokens.inkMuted, width: 180, overflow: 'truncate', interval: 0 },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: tokens.axis } },
        inverse: true,
      },
      series: analysis.methods.map(method => ({
        id: `routes-bar-${method}-${seed}`,
        type: 'bar' as const,
        name: methodLabel(method, t),
        stack: 'routes',
        barMaxWidth: 24,
        // 2px surface gap between stacked segments (DESIGN-SYSTEM §1.6).
        itemStyle: { color: methodSlot(method, tokens), borderColor: tokens.surface, borderWidth: 1 },
        emphasis: { focus: 'series' as const },
        data: analysis.groups.map(group => ({
          value: group.methodCounts[method] ?? 0,
          displayName: group.label,
          kind: 'group',
          framework: group.framework,
          routeCount: group.routeCount,
          sourceCount: group.sourceCount,
          method,
        })),
      })),
    };
  }

  if (variant === 'sankey') {
    return {
      ...base,
      tooltip: { trigger: 'item', ...tooltipChrome(tokens), formatter: structureFormatter(ctx) },
      series: [
        {
          id: `routes-sankey-${seed}`,
          type: 'sankey',
          data: flow.nodes.map(node => ({
            ...decorateFlowNode(node, tokens),
            value: node.methodCount ?? node.routeCount,
            depth: KIND_DEPTH[node.kind] - 1,
          })),
          links: flow.links,
          nodeWidth: 16,
          nodeGap: 16,
          left: 16,
          right: 100,
          top: 16,
          bottom: 16,
          draggable: false,
          emphasis: { focus: 'adjacency' },
          levels: [0, 1, 2].map(depth => ({
            depth,
            itemStyle: { borderWidth: depth === 0 ? 2 : 1.5 },
            lineStyle: { color: 'source', opacity: 0.26 },
          })),
          lineStyle: { color: 'source', opacity: 0.26, curveness: 0.5 },
          label: {
            color: tokens.ink,
            fontSize: 12,
            formatter: params => {
              const data = typeof params === 'object' && params && 'data' in params ? params.data as RouteFlowNode : null;
              return data?.displayName ?? '';
            },
          },
        },
      ],
    };
  }

  if (variant === 'treemap') {
    return {
      ...base,
      tooltip: { trigger: 'item', ...tooltipChrome(tokens), formatter: structureFormatter(ctx) },
      series: [
        {
          id: `routes-treemap-${seed}`,
          type: 'treemap',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          data: (hierarchy.root.children ?? []).map(child => decorateHierarchyNode(child, tokens, locale)),
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          label: {
            show: true,
            color: tokens.ink,
            formatter: params => {
              const data = typeof params === 'object' && params && 'data' in params ? params.data as RouteHierarchyNode : null;
              return data?.displayName ?? '';
            },
          },
          upperLabel: { show: true, color: tokens.ink, height: 24 },
          itemStyle: { borderColor: tokens.surface, borderWidth: 2, gapWidth: 2 },
        },
      ],
    };
  }

  // Force graph uses categorical slots 1–3 for the three node kinds.
  return {
    ...base,
    tooltip: { trigger: 'item', ...tooltipChrome(tokens), formatter: structureFormatter(ctx) },
    color: tokens.categorical.slice(0, 3),
    legend: {
      bottom: 0,
      left: 0,
      textStyle: { color: tokens.ink },
      data: [t('apiRoutes.framework'), t('apiRoutes.pathPrefix'), t('apiRoutes.methods')],
    },
    series: [
      {
        id: `routes-graph-${seed}`,
        type: 'graph',
        layout: 'force',
        data: flow.nodes.map(node => decorateFlowNode(node, tokens)),
        links: flow.links,
        categories: [
          { name: t('apiRoutes.framework') },
          { name: t('apiRoutes.pathPrefix') },
          { name: t('apiRoutes.methods') },
        ],
        roam: true,
        draggable: true,
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: [0, 8],
        force: {
          repulsion: 260,
          gravity: 0.08,
          edgeLength: [80, 180],
          friction: 0.55,
        },
        emphasis: {
          focus: 'adjacency',
          itemStyle: { borderColor: tokens.markRing, borderWidth: 2 },
          lineStyle: { width: 1.2, opacity: 0.32 },
        },
        lineStyle: {
          color: 'source',
          opacity: 0.32,
          width: 1.2,
          curveness: 0.08,
        },
        labelLayout: { hideOverlap: true },
      },
    ],
  };
}

export default function ApiRoutesGraph({
  ctx,
  height,
  onEvents,
}: {
  ctx: RouteChartContext;
  height: number;
  onEvents: ChartEvents;
}) {
  const option = useCallback((tokens: ChartTokens) => routeChartOption(tokens, ctx), [ctx]);

  return (
    <Panel className="overflow-hidden">
      {ctx.variant !== 'treemap' ? (
        <p className="mb-2 text-xs text-fg-muted">{ctx.t('apiRoutes.methodCountHint')}</p>
      ) : null}
      {(ctx.variant === 'heatmap' || ctx.variant === 'stackedBar') && ctx.analysis.groupCount > VISIBLE_ANALYSIS_GROUPS ? (
        <p className="mb-2 text-xs text-fg-muted">{ctx.t('apiRoutes.scrollGroupsHint', { count: ctx.analysis.groupCount })}</p>
      ) : null}
      <Chart
        option={option}
        ariaLabel={`${ctx.t('apiRoutes.title')} · ${routeChartVariantLabel(ctx.variant, ctx.t)}`}
        height={height}
        onEvents={onEvents}
      />
    </Panel>
  );
}
