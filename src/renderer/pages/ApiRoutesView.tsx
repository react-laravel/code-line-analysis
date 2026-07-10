import React, { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { useNavigate } from 'react-router-dom';
import type { ApiRouteEntry, ApiRouteOverview, FolderRow } from '../../shared/api';
import EChartsPanel from '../components/EChartsPanel';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import { useI18n } from '../i18n';
import { escapeHtml } from '../utils/escapeHtml';

interface Props {
  folder: FolderRow | null;
  scanRevision: number;
}

function emptyOverview(): ApiRouteOverview {
  return { frameworks: [], routes: [], laravelRouteFiles: 0, nextRouteFiles: 0, warnings: [] };
}

function frameworkLabel(framework: ApiRouteEntry['framework'], t: ReturnType<typeof useI18n>['t']): string {
  if (framework === 'laravel') return t('apiRoutes.frameworkLaravel');
  if (framework === 'next-app') return t('apiRoutes.frameworkNextApp');
  return t('apiRoutes.frameworkNextPages');
}

function methodLabel(method: string, t: ReturnType<typeof useI18n>['t']): string {
  if (method === 'PAGE') return t('apiRoutes.pageType');
  return method;
}

type RouteTreeNode = {
  name: string;
  nodeType: 'root' | 'framework' | 'segment' | 'route';
  children?: RouteTreeNode[];
  routeCount: number;
  fullPath?: string;
  sourceFile?: string;
  framework?: ApiRouteEntry['framework'];
  methods?: string[];
  handler?: string;
  routeName?: string | null;
  isEndpoint?: boolean;
  value?: number;
  itemStyle?: { color?: string; borderColor?: string; borderWidth?: number };
  lineStyle?: { color?: string; width?: number; opacity?: number };
};

type RouteGroup = {
  key: string;
  label: string;
  routes: ApiRouteEntry[];
};

type FrameworkRouteSection = {
  framework: ApiRouteEntry['framework'];
  routes: ApiRouteEntry[];
  groups: RouteGroup[];
};

type DisplayMode = 'list' | 'graph';

type RouteChartVariant = 'force' | 'circular' | 'sankey' | 'tree' | 'sunburst' | 'treemap' | 'heatmap' | 'stackedBar';

type RouteFlowNode = {
  name: string;
  displayName: string;
  kind: 'root' | 'framework' | 'group' | 'method';
  framework?: ApiRouteEntry['framework'];
  method?: string;
  routeCount: number;
  methods?: string[];
  sourceCount?: number;
  symbolSize?: number;
  category?: number;
  itemStyle?: { color?: string; borderColor?: string; borderWidth?: number };
  label?: { show?: boolean; color?: string; fontSize?: number; fontWeight?: number; formatter?: string };
  emphasis?: {
    scale?: boolean;
    itemStyle?: { borderColor?: string; borderWidth?: number; shadowBlur?: number; shadowColor?: string };
    label?: { show?: boolean };
  };
};

type RouteHierarchyNode = RouteFlowNode & {
  value: number;
  children?: RouteHierarchyNode[];
  collapsed?: boolean;
};

type RouteHierarchyChart = {
  groupDepth: number;
  groupCount: number;
  root: RouteHierarchyNode;
  chartHeight: number;
};

type RouteFlowLink = {
  source: string;
  target: string;
  value: number;
};

type RouteAnalysisGroup = {
  key: string;
  framework: ApiRouteEntry['framework'];
  label: string;
  displayName: string;
  routeCount: number;
  methodCounts: Record<string, number>;
};

type RouteAnalysisChart = {
  groupDepth: number;
  groupCount: number;
  groups: RouteAnalysisGroup[];
  methods: string[];
  maxValue: number;
  chartHeight: number;
};

type RouteFlowGraph = {
  groupDepth: number;
  groupCount: number;
  nodes: RouteFlowNode[];
  links: RouteFlowLink[];
  chartHeight: number;
};

const CHART_TEXT = '#e6edf3';
const CHART_MUTED = '#8b949e';
const CHART_BORDER = '#2a313c';
const CHART_TOOLTIP_BACKGROUND = '#161b22';
const FRAMEWORK_COLORS: Record<ApiRouteEntry['framework'], string> = {
  laravel: '#7cc7a0',
  'next-app': '#73b9ff',
  'next-pages': '#e2b86b',
};
const METHOD_COLORS: Record<string, string> = {
  GET: '#7cc7a0',
  POST: '#73b9ff',
  PUT: '#e2b86b',
  PATCH: '#d9a95f',
  DELETE: '#ff8c8c',
  PAGE: '#74d5d5',
  OPTIONS: '#a7b0bd',
  HEAD: '#a7b0bd',
  ANY: '#c4b5fd',
};

function depthButtonLabel(level: number, t: ReturnType<typeof useI18n>['t']): string {
  return t('apiRoutes.depthLevel', { count: level });
}

function splitRouteSegments(routePath: string): string[] {
  return routePath.split('/').filter(Boolean);
}

function maxRoutePathDepth(routes: ApiRouteEntry[]): number {
  return routes.reduce((maxDepth, route) => Math.max(maxDepth, splitRouteSegments(route.path).length), 0);
}

function prefixPath(routePath: string, depth: number): string {
  const segments = splitRouteSegments(routePath).slice(0, depth);
  return segments.length > 0 ? `/${segments.join('/')}` : '/';
}

function tailPath(routePath: string, depth: number | null): string {
  if (depth == null) return routePath;

  const segments = splitRouteSegments(routePath);
  if (segments.length <= depth) return '/';
  return `/${segments.slice(depth).join('/')}`;
}

function methodChipClass(method: string): string {
  const normalized = method.toUpperCase();
  if (normalized === 'GET') return 'api-method-chip api-method-get';
  if (normalized === 'POST') return 'api-method-chip api-method-post';
  if (normalized === 'PUT') return 'api-method-chip api-method-put';
  if (normalized === 'PATCH') return 'api-method-chip api-method-patch';
  if (normalized === 'DELETE') return 'api-method-chip api-method-delete';
  if (normalized === 'PAGE') return 'api-method-chip api-method-page';
  if (normalized === 'OPTIONS') return 'api-method-chip api-method-options';
  if (normalized === 'HEAD') return 'api-method-chip api-method-head';
  return 'api-method-chip api-method-any';
}

function displayModeLabel(mode: DisplayMode, t: ReturnType<typeof useI18n>['t']): string {
  return mode === 'graph' ? t('apiRoutes.viewGraph') : t('apiRoutes.viewList');
}

function routeChartVariantLabel(variant: RouteChartVariant, t: ReturnType<typeof useI18n>['t']): string {
  if (variant === 'circular') return t('apiRoutes.chartCircular');
  if (variant === 'heatmap') return t('apiRoutes.chartHeatmap');
  if (variant === 'sankey') return t('apiRoutes.chartSankey');
  if (variant === 'stackedBar') return t('apiRoutes.chartStackedBar');
  if (variant === 'tree') return t('apiRoutes.chartTree');
  if (variant === 'sunburst') return t('apiRoutes.chartSunburst');
  if (variant === 'treemap') return t('apiRoutes.chartTreemap');
  return t('apiRoutes.chartForce');
}

function routeKey(route: ApiRouteEntry): string {
  return [route.framework, route.path, route.handler, route.sourceFile, route.routeName ?? '', route.methods.join(',')].join('|');
}

function translateApiRouteWarning(warning: string, t: ReturnType<typeof useI18n>['t']): string {
  if (warning === 'Laravel route groups are expanded best-effort; dynamic group attributes or runtime-defined routes can still be incomplete.') {
    return t('apiRoutes.warningGroupBestEffort');
  }

  const missingIncludedFilesMatch = warning.match(/^Laravel included route files were referenced but not found in the scan:\s*(.+)$/);
  if (missingIncludedFilesMatch?.[1]) {
    return t('apiRoutes.warningMissingIncludedFiles', { value: missingIncludedFilesMatch[1] });
  }

  return warning;
}

function frameworkNodeId(framework: ApiRouteEntry['framework']): string {
  return `framework:${framework}`;
}

function groupNodeId(framework: ApiRouteEntry['framework'], groupLabel: string): string {
  return `group:${framework}:${groupLabel}`;
}

function methodNodeId(method: string): string {
  return `method:${method.toUpperCase()}`;
}

function methodColor(method: string): string {
  return METHOD_COLORS[method.toUpperCase()] ?? METHOD_COLORS.ANY;
}

function buildRouteSections(routes: ApiRouteEntry[], groupDepth: number | null): FrameworkRouteSection[] {
  const frameworkMap = new Map<ApiRouteEntry['framework'], ApiRouteEntry[]>();

  for (const route of routes) {
    const frameworkRoutes = frameworkMap.get(route.framework) ?? [];
    frameworkRoutes.push(route);
    frameworkMap.set(route.framework, frameworkRoutes);
  }

  return Array.from(frameworkMap.entries()).map(([framework, frameworkRoutes]) => {
    if (groupDepth == null) {
      return {
        framework,
        routes: frameworkRoutes,
        groups: [],
      };
    }

    const groups = new Map<string, ApiRouteEntry[]>();

    for (const route of frameworkRoutes) {
      const groupLabel = prefixPath(route.path, groupDepth);
      const groupRoutes = groups.get(groupLabel) ?? [];
      groupRoutes.push(route);
      groups.set(groupLabel, groupRoutes);
    }

    return {
      framework,
      routes: frameworkRoutes,
      groups: Array.from(groups.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, groupRoutes]) => ({
          key: `${framework}|${label}`,
          label,
          routes: groupRoutes,
        })),
    };
  });
}

function buildRouteFlowGraph(routes: ApiRouteEntry[], groupDepth: number, t: ReturnType<typeof useI18n>['t']): RouteFlowGraph {
  const frameworkCounts = new Map<ApiRouteEntry['framework'], number>();
  const groups = new Map<string, { framework: ApiRouteEntry['framework']; label: string; routeCount: number; methods: Set<string>; sourceFiles: Set<string> }>();
  const methodCounts = new Map<string, number>();
  const groupMethodCounts = new Map<string, { framework: ApiRouteEntry['framework']; label: string; method: string; count: number }>();

  for (const route of routes) {
    frameworkCounts.set(route.framework, (frameworkCounts.get(route.framework) ?? 0) + 1);

    const label = prefixPath(route.path, groupDepth);
    const key = `${route.framework}|${label}`;
    const existing = groups.get(key) ?? {
      framework: route.framework,
      label,
      routeCount: 0,
      methods: new Set<string>(),
      sourceFiles: new Set<string>(),
    };

    existing.routeCount += 1;
    route.methods.forEach(method => {
      const normalizedMethod = method.toUpperCase();
      const groupMethodKey = `${key}|${normalizedMethod}`;
      const currentGroupMethod = groupMethodCounts.get(groupMethodKey) ?? {
        framework: route.framework,
        label,
        method: normalizedMethod,
        count: 0,
      };

      existing.methods.add(normalizedMethod);
      methodCounts.set(normalizedMethod, (methodCounts.get(normalizedMethod) ?? 0) + 1);
      currentGroupMethod.count += 1;
      groupMethodCounts.set(groupMethodKey, currentGroupMethod);
    });
    existing.sourceFiles.add(route.sourceFile);
    groups.set(key, existing);
  }

  const nodes: RouteFlowNode[] = Array.from(frameworkCounts.entries())
    .sort(([left], [right]) => frameworkLabel(left, t).localeCompare(frameworkLabel(right, t)))
    .map(([framework, routeCount]) => ({
      name: frameworkNodeId(framework),
      displayName: frameworkLabel(framework, t),
      kind: 'framework',
      framework,
      routeCount,
      category: 0,
      symbolSize: 42 + Math.min(26, Math.sqrt(routeCount) * 4),
      itemStyle: { color: FRAMEWORK_COLORS[framework], borderColor: 'rgba(255,255,255,0.32)', borderWidth: 2 },
      label: { show: true, color: CHART_TEXT, fontSize: 13, fontWeight: 700, formatter: frameworkLabel(framework, t) },
      emphasis: {
        scale: true,
        itemStyle: { borderColor: '#ffffff', borderWidth: 2.5, shadowBlur: 18, shadowColor: 'rgba(124, 199, 160, 0.24)' },
        label: { show: true },
      },
    }));

  const links: RouteFlowLink[] = [];
  const groupEntries = Array.from(groups.values()).sort((left, right) => left.framework.localeCompare(right.framework) || left.label.localeCompare(right.label));

  for (const entry of groupEntries) {
    const nodeId = groupNodeId(entry.framework, entry.label);
    nodes.push({
      name: nodeId,
      displayName: entry.label,
      kind: 'group',
      framework: entry.framework,
      routeCount: entry.routeCount,
      methods: Array.from(entry.methods).sort(),
      sourceCount: entry.sourceFiles.size,
      category: 1,
      symbolSize: 22 + Math.min(32, Math.sqrt(entry.routeCount) * 5),
      itemStyle: { color: 'rgba(124, 199, 160, 0.82)', borderColor: FRAMEWORK_COLORS[entry.framework], borderWidth: 1.5 },
      label: { show: entry.routeCount >= 2, color: CHART_TEXT, fontSize: 11, formatter: entry.label },
      emphasis: {
        scale: true,
        itemStyle: { borderColor: '#ffffff', borderWidth: 2, shadowBlur: 16, shadowColor: 'rgba(115, 185, 255, 0.18)' },
        label: { show: true },
      },
    });
    links.push({
      source: frameworkNodeId(entry.framework),
      target: nodeId,
      value: entry.routeCount,
    });
  }

  for (const [method, routeCount] of Array.from(methodCounts.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    nodes.push({
      name: methodNodeId(method),
      displayName: methodLabel(method, t),
      kind: 'method',
      method,
      routeCount,
      category: 2,
      symbolSize: 24 + Math.min(28, Math.sqrt(routeCount) * 4),
      itemStyle: { color: methodColor(method), borderColor: 'rgba(255,255,255,0.26)', borderWidth: 1.5 },
      label: { show: true, color: CHART_TEXT, fontSize: 11, formatter: methodLabel(method, t) },
      emphasis: {
        scale: true,
        itemStyle: { borderColor: '#ffffff', borderWidth: 2, shadowBlur: 14, shadowColor: 'rgba(255, 255, 255, 0.14)' },
        label: { show: true },
      },
    });
  }

  for (const entry of groupMethodCounts.values()) {
    links.push({
      source: groupNodeId(entry.framework, entry.label),
      target: methodNodeId(entry.method),
      value: entry.count,
    });
  }

  return {
    groupDepth,
    groupCount: groupEntries.length,
    nodes,
    links,
    chartHeight: Math.max(620, Math.min(980, 460 + (groupEntries.length * 8))),
  };
}

function buildRouteHierarchy(routes: ApiRouteEntry[], groupDepth: number, t: ReturnType<typeof useI18n>['t']): RouteHierarchyChart {
  const frameworkNodes = new Map<ApiRouteEntry['framework'], RouteHierarchyNode>();
  const groupNodes = new Map<string, RouteHierarchyNode>();
  const groupMethods = new Map<string, Set<string>>();

  const root: RouteHierarchyNode = {
    name: 'root',
    displayName: t('apiRoutes.treeRoot'),
    kind: 'root',
    routeCount: routes.length,
    value: routes.length,
    children: [],
    itemStyle: { color: 'rgba(115, 185, 255, 0.16)', borderColor: 'rgba(255,255,255,0.24)', borderWidth: 2 },
  };

  for (const route of routes) {
    const frameworkNode = frameworkNodes.get(route.framework) ?? {
      name: frameworkNodeId(route.framework),
      displayName: frameworkLabel(route.framework, t),
      kind: 'framework' as const,
      framework: route.framework,
      routeCount: 0,
      value: 0,
      children: [],
      itemStyle: { color: FRAMEWORK_COLORS[route.framework], borderColor: 'rgba(255,255,255,0.32)', borderWidth: 2 },
      label: { color: CHART_TEXT, fontSize: 13, fontWeight: 700, formatter: frameworkLabel(route.framework, t) },
    };

    if (!frameworkNodes.has(route.framework)) {
      frameworkNodes.set(route.framework, frameworkNode);
      root.children?.push(frameworkNode);
    }

    frameworkNode.routeCount += 1;
    frameworkNode.value = frameworkNode.routeCount;

    const groupLabel = prefixPath(route.path, groupDepth);
    const groupKey = `${route.framework}|${groupLabel}`;
    const groupNode = groupNodes.get(groupKey) ?? {
      name: groupNodeId(route.framework, groupLabel),
      displayName: groupLabel,
      kind: 'group' as const,
      framework: route.framework,
      routeCount: 0,
      value: 0,
      methods: [],
      children: [],
      itemStyle: { color: 'rgba(124, 199, 160, 0.82)', borderColor: FRAMEWORK_COLORS[route.framework], borderWidth: 1.5 },
      label: { color: CHART_TEXT, fontSize: 11, formatter: groupLabel },
    };

    if (!groupNodes.has(groupKey)) {
      groupNodes.set(groupKey, groupNode);
      groupMethods.set(groupKey, new Set<string>());
      frameworkNode.children?.push(groupNode);
    }

    groupNode.routeCount += 1;
    groupNode.value = groupNode.routeCount;

    const methods = groupMethods.get(groupKey)!;
    route.methods.forEach(method => {
      const normalizedMethod = method.toUpperCase();
      methods.add(normalizedMethod);

      const existingMethodNode = groupNode.children?.find(child => child.kind === 'method' && child.method === normalizedMethod);
      if (existingMethodNode) {
        existingMethodNode.routeCount += 1;
        existingMethodNode.value = existingMethodNode.routeCount;
        return;
      }

      groupNode.children?.push({
        name: `${groupNodeId(route.framework, groupLabel)}:${normalizedMethod}`,
        displayName: methodLabel(normalizedMethod, t),
        kind: 'method',
        method: normalizedMethod,
        routeCount: 1,
        value: 1,
        itemStyle: { color: methodColor(normalizedMethod), borderColor: 'rgba(255,255,255,0.26)', borderWidth: 1.5 },
        label: { color: CHART_TEXT, fontSize: 11, formatter: methodLabel(normalizedMethod, t) },
      });
    });

    groupNode.methods = Array.from(methods).sort();
  }

  root.children = (root.children ?? [])
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map(frameworkNode => ({
      ...frameworkNode,
      children: (frameworkNode.children ?? [])
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
        .map(groupNode => ({
          ...groupNode,
          children: (groupNode.children ?? []).sort((left, right) => left.displayName.localeCompare(right.displayName)),
        })),
    }));

  return {
    groupDepth,
    groupCount: groupNodes.size,
    root,
    chartHeight: Math.max(640, Math.min(1040, 480 + (groupNodes.size * 10))),
  };
}

function buildRouteAnalysisChart(routes: ApiRouteEntry[], groupDepth: number, t: ReturnType<typeof useI18n>['t']): RouteAnalysisChart {
  const groupMap = new Map<string, {
    framework: ApiRouteEntry['framework'];
    label: string;
    routeCount: number;
    methodCounts: Map<string, number>;
  }>();
  const methods = new Set<string>();

  for (const route of routes) {
    const label = prefixPath(route.path, groupDepth);
    const key = `${route.framework}|${label}`;
    const entry = groupMap.get(key) ?? {
      framework: route.framework,
      label,
      routeCount: 0,
      methodCounts: new Map<string, number>(),
    };

    entry.routeCount += 1;
    route.methods.forEach(method => {
      const normalizedMethod = method.toUpperCase();
      methods.add(normalizedMethod);
      entry.methodCounts.set(normalizedMethod, (entry.methodCounts.get(normalizedMethod) ?? 0) + 1);
    });

    groupMap.set(key, entry);
  }

  const methodList = Array.from(methods).sort((left, right) => left.localeCompare(right));
  const groups = Array.from(groupMap.entries())
    .sort((left, right) => right[1].routeCount - left[1].routeCount || left[1].framework.localeCompare(right[1].framework) || left[1].label.localeCompare(right[1].label))
    .map(([key, entry]) => ({
      key,
      framework: entry.framework,
      label: entry.label,
      displayName: `${frameworkLabel(entry.framework, t)} · ${entry.label}`,
      routeCount: entry.routeCount,
      methodCounts: methodList.reduce<Record<string, number>>((acc, method) => {
        acc[method] = entry.methodCounts.get(method) ?? 0;
        return acc;
      }, {}),
    }));

  const maxValue = groups.reduce((maxCount, group) => {
    const groupMax = methodList.reduce((methodMax, method) => Math.max(methodMax, group.methodCounts[method] ?? 0), 0);
    return Math.max(maxCount, groupMax);
  }, 0);

  return {
    groupDepth,
    groupCount: groups.length,
    groups,
    methods: methodList,
    maxValue,
    chartHeight: Math.max(620, Math.min(1180, 280 + (groups.length * 30))),
  };
}

function allSame<T>(arr: T[]): boolean {
  if (arr.length <= 1) return true;
  return arr.every(item => item === arr[0]);
}

function buildColumnPlan(
  routes: ApiRouteEntry[],
  groupDepth: number | null,
  t: ReturnType<typeof useI18n>['t'],
): { header: string; key: string; render: (route: ApiRouteEntry) => React.ReactNode; summary?: React.ReactNode }[] {
  if (routes.length === 0) return [];

  const methods = routes.map(route => route.methods.join(','));
  const handlers = routes.map(route => route.handler);
  const routeNames = routes.map(route => route.routeName ?? '-');
  const sources = routes.map(route => route.sourceFile);

  const plan: { header: string; key: string; render: (route: ApiRouteEntry) => React.ReactNode; summary?: React.ReactNode }[] = [
    { header: t('apiRoutes.path'), key: 'path', render: route => <span className="mono">{tailPath(route.path, groupDepth)}</span> },
    { header: t('apiRoutes.source'), key: 'source', render: route => <span className="mono">{route.sourceFile}</span> },
  ];

  if (!allSame(methods)) {
    plan.unshift({
      header: t('apiRoutes.methods'),
      key: 'methods',
      render: route => (
        <div className="api-method-list">
          {route.methods.map(method => (
            <span key={method} className={methodChipClass(method)}>{methodLabel(method, t)}</span>
          ))}
        </div>
      ),
    });
  } else if (methods.length > 0) {
    const sample = routes[0].methods;
    plan.unshift({
      header: t('apiRoutes.methods'),
      key: 'methods',
      render: () => (
        <div className="api-method-list">
          {sample.map(method => (
            <span key={method} className={methodChipClass(method)}>{methodLabel(method, t)}</span>
          ))}
        </div>
      ),
      summary: (
        <span className="status-pill">
          {t('apiRoutes.methods')}: {sample.map(method => methodLabel(method, t)).join(', ')}
        </span>
      ),
    });
  }

  if (!allSame(handlers)) {
    plan.splice(plan.findIndex(col => col.key === 'path'), 0, {
      header: t('apiRoutes.handler'),
      key: 'handler',
      render: route => <span className="mono">{route.handler}</span>,
    });
  } else if (handlers.length > 0) {
    const sample = routes[0].handler;
    plan.splice(plan.findIndex(col => col.key === 'path'), 0, {
      header: t('apiRoutes.handler'),
      key: 'handler',
      render: () => <span className="mono">{sample}</span>,
      summary: <span className="status-pill">{t('apiRoutes.handler')}: {sample}</span>,
    });
  }

  if (!allSame(routeNames)) {
    plan.splice(plan.findIndex(col => col.key === 'path') + 1, 0, {
      header: t('apiRoutes.routeName'),
      key: 'routeName',
      render: route => <span className="mono">{route.routeName ?? '-'}</span>,
    });
  } else if (routeNames.length > 0 && routeNames[0] !== '-') {
    const sample = routes[0].routeName!;
    plan.splice(plan.findIndex(col => col.key === 'path') + 1, 0, {
      header: t('apiRoutes.routeName'),
      key: 'routeName',
      render: () => <span className="mono">{sample}</span>,
      summary: <span className="status-pill">{t('apiRoutes.routeName')}: {sample}</span>,
    });
  }

  if (!allSame(sources)) {
    plan.splice(plan.length, 0, {
      header: t('apiRoutes.source'),
      key: 'source',
      render: route => <span className="mono">{route.sourceFile}</span>,
    });
  } else if (sources.length > 0) {
    const sample = routes[0].sourceFile;
    plan.push({
      header: t('apiRoutes.source'),
      key: 'source',
      render: () => <span className="mono">{sample}</span>,
      summary: <span className="status-pill">{t('apiRoutes.source')}: {sample}</span>,
    });
  }

  return plan;
}

function RouteTable({
  routes,
  groupDepth,
  locale,
  onOpen,
  t,
}: {
  routes: ApiRouteEntry[];
  groupDepth: number | null;
  locale: string;
  onOpen: (sourceFile: string) => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const columnPlan = useMemo(() => buildColumnPlan(routes, groupDepth, t), [routes, groupDepth, t]);
  const summaryItems = columnPlan.filter(col => col.summary);

  return (
    <div>
      {summaryItems.length > 0 && (
        <div className="api-routes-summary-bar" style={{ marginBottom: 8 }}>
          <div className="flex flex-wrap gap-2">
            {summaryItems.map(col => (
              <span key={col.key}>{col.summary}</span>
            ))}
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table className="api-routes-table">
          <thead>
            <tr>
              {columnPlan.filter(col => !col.summary).map(col => (
                <th key={col.key}>{col.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {routes.map(route => {
              const pathLabel = tailPath(route.path, groupDepth);
              return (
                <tr key={routeKey(route)} className="clickable-row" onClick={() => onOpen(route.sourceFile)}>
                  {columnPlan.filter(col => !col.summary).map(col => (
                    <td key={col.key}>{col.render(route)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ApiRoutesView({ folder, scanRevision }: Props) {
  const [overview, setOverview] = useState<ApiRouteOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [frameworkFilter, setFrameworkFilter] = useState<'all' | ApiRouteEntry['framework']>('all');
  const [searchText, setSearchText] = useState('');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('list');
  const [chartVariant, setChartVariant] = useState<RouteChartVariant>('force');
  const [visibleDepth, setVisibleDepth] = useState<number | null>(null);
  const navigate = useNavigate();
  const { locale, t } = useI18n();

  useEffect(() => {
    let ignore = false;

    if (!folder) {
      setOverview(null);
      setLoading(false);
      setDisplayMode('list');
      setChartVariant('force');
      setVisibleDepth(null);
      return () => { ignore = true; };
    }

    setLoading(true);
    void window.api.stats.apiRoutes(folder.id).then(nextOverview => {
      if (ignore) return;
      setOverview(nextOverview);
      setVisibleDepth(nextOverview.routes.length > 120 ? Math.min(2, Math.max(maxRoutePathDepth(nextOverview.routes), 1)) : null);
      setLoading(false);
    }).catch(() => {
      if (ignore) return;
      setOverview(emptyOverview());
      setVisibleDepth(null);
      setLoading(false);
    });

    return () => { ignore = true; };
  }, [folder?.id, scanRevision]);

  const filteredRoutes = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    return (overview?.routes ?? []).filter(route => {
      if (frameworkFilter !== 'all' && route.framework !== frameworkFilter) return false;
      if (!normalizedSearch) return true;
      return [route.path, route.handler, route.sourceFile, route.routeName ?? '', route.methods.join(' ')].some(value => value.toLowerCase().includes(normalizedSearch));
    });
  }, [frameworkFilter, overview?.routes, searchText]);

  const routeDepthMax = useMemo(() => maxRoutePathDepth(filteredRoutes), [filteredRoutes]);
  const depthOptions = useMemo(
    () => Array.from({ length: Math.min(routeDepthMax, 6) }, (_value, index) => index + 1),
    [routeDepthMax],
  );
  const routeSections = useMemo(() => buildRouteSections(filteredRoutes, visibleDepth), [filteredRoutes, visibleDepth]);
  const graphGroupDepth = useMemo(() => {
    if (visibleDepth != null) return visibleDepth;
    if (routeDepthMax === 0) return 1;
    return Math.min(routeDepthMax, 2);
  }, [routeDepthMax, visibleDepth]);
  const routeFlowGraph = useMemo(() => buildRouteFlowGraph(filteredRoutes, graphGroupDepth, t), [filteredRoutes, graphGroupDepth, t]);
  const routeHierarchy = useMemo(() => buildRouteHierarchy(filteredRoutes, graphGroupDepth, t), [filteredRoutes, graphGroupDepth, t]);
  const routeAnalysis = useMemo(() => buildRouteAnalysisChart(filteredRoutes, graphGroupDepth, t), [filteredRoutes, graphGroupDepth, t]);
  const chartHeight = useMemo(() => {
    if (chartVariant === 'heatmap' || chartVariant === 'stackedBar') return Math.max(620, Math.min(1120, routeAnalysis.chartHeight));
    if (chartVariant === 'sankey') return Math.max(580, Math.min(980, 380 + (routeFlowGraph.nodes.length * 16)));
    if (chartVariant === 'tree') return Math.max(720, Math.min(1080, routeHierarchy.chartHeight));
    if (chartVariant === 'sunburst') return Math.max(620, Math.min(920, routeHierarchy.chartHeight - 40));
    if (chartVariant === 'treemap') return Math.max(620, Math.min(920, routeHierarchy.chartHeight - 40));
    if (chartVariant === 'circular') return Math.max(620, Math.min(920, routeFlowGraph.chartHeight - 20));
    return routeFlowGraph.chartHeight;
  }, [chartVariant, routeAnalysis.chartHeight, routeFlowGraph.chartHeight, routeFlowGraph.nodes.length, routeHierarchy.chartHeight]);
  const graphOption = useMemo<EChartsOption>(() => ({
    animation: true,
    animationDuration: 450,
    animationDurationUpdate: 320,
    tooltip: {
      trigger: chartVariant === 'stackedBar' ? 'item' : 'item',
      backgroundColor: CHART_TOOLTIP_BACKGROUND,
      borderColor: CHART_BORDER,
      textStyle: { color: CHART_TEXT },
      formatter: params => {
        if (chartVariant === 'heatmap') {
          const data = typeof params === 'object' && params && 'data' in params ? params.data as {
            value: [number, number, number];
            displayName: string;
            framework: ApiRouteEntry['framework'];
            routeCount: number;
            method: string;
          } : null;
          if (!data) return '';
          return [
            escapeHtml(data.displayName),
            `${t('apiRoutes.methods')}: ${methodLabel(data.method, t)}`,
            `${t('apiRoutes.routes')}: ${Number(data.value?.[2] ?? 0).toLocaleString(locale)}`,
            `${t('common.files')}: ${data.routeCount.toLocaleString(locale)}`,
          ].join('<br/>');
        }

        if (chartVariant === 'stackedBar') {
          const data = typeof params === 'object' && params && 'data' in params ? params.data as {
            value: number;
            displayName: string;
            framework: ApiRouteEntry['framework'];
            routeCount: number;
            method: string;
          } : null;
          if (!data) return '';
          return [
            escapeHtml(data.displayName),
            `${t('apiRoutes.methods')}: ${methodLabel(data.method, t)}`,
            `${t('apiRoutes.routes')}: ${Number(data.value ?? 0).toLocaleString(locale)}`,
            `${t('common.files')}: ${data.routeCount.toLocaleString(locale)}`,
          ].join('<br/>');
        }

        const payload = typeof params === 'object' && params && 'dataType' in params ? params as {
          dataType?: string;
          value?: number;
          data?: RouteFlowNode;
        } : null;

        if (!payload) return '';
        if (payload.dataType === 'edge') return `${t('apiRoutes.routes')}: ${Number(payload.value ?? 0).toLocaleString(locale)}`;

        const data = payload.data;
        if (!data) return '';

        const lines = [
          escapeHtml(data.displayName),
          `${t('apiRoutes.routes')}: ${data.routeCount.toLocaleString(locale)}`,
        ];

        if (data.kind === 'group') {
          lines.push(`${t('apiRoutes.depth')}: ${routeFlowGraph.groupDepth.toLocaleString(locale)}`);
          lines.push(`${t('common.files')}: ${Number(data.sourceCount ?? 0).toLocaleString(locale)}`);
          if (data.methods && data.methods.length > 0) lines.push(`${t('apiRoutes.methods')}: ${data.methods.map(method => methodLabel(method, t)).join(' / ')}`);
        }

        if (data.kind === 'method' && data.method) lines.push(`${t('apiRoutes.methods')}: ${methodLabel(data.method, t)}`);

        return lines.join('<br/>');
      },
    },
    legend: chartVariant === 'stackedBar' ? {
      top: 0,
      textStyle: { color: CHART_MUTED },
    } : undefined,
    visualMap: chartVariant === 'heatmap' ? {
      min: 0,
      max: Math.max(1, routeAnalysis.maxValue),
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      textStyle: { color: CHART_MUTED },
      inRange: {
        color: ['#151c24', '#24495e', '#2b77a6', '#73b9ff'],
      },
    } : undefined,
    grid: chartVariant === 'heatmap' || chartVariant === 'stackedBar' ? {
      top: chartVariant === 'stackedBar' ? 56 : 18,
      left: 24,
      right: 18,
      bottom: chartVariant === 'heatmap' ? 84 : 20,
      containLabel: true,
    } : undefined,
    xAxis: chartVariant === 'heatmap'
      ? {
        type: 'category',
        data: routeAnalysis.methods.map(method => methodLabel(method, t)),
        splitArea: { show: true },
        axisLabel: { color: CHART_MUTED },
        axisLine: { lineStyle: { color: CHART_BORDER } },
      }
      : chartVariant === 'stackedBar'
        ? {
          type: 'value',
          axisLabel: { color: CHART_MUTED },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
        }
        : undefined,
    yAxis: chartVariant === 'heatmap'
      ? {
        type: 'category',
        data: routeAnalysis.groups.map(group => group.displayName),
        splitArea: { show: true },
        axisLabel: { color: CHART_MUTED, width: 220, overflow: 'truncate' },
        axisLine: { lineStyle: { color: CHART_BORDER } },
        inverse: true,
      }
      : chartVariant === 'stackedBar'
        ? {
          type: 'category',
          data: routeAnalysis.groups.map(group => group.displayName),
          axisLabel: { color: CHART_MUTED, width: 220, overflow: 'truncate' },
          axisTick: { show: false },
          axisLine: { lineStyle: { color: CHART_BORDER } },
          inverse: true,
        }
        : undefined,
    series: chartVariant === 'heatmap'
      ? [
        {
          type: 'heatmap',
          data: routeAnalysis.groups.flatMap((group, groupIndex) => routeAnalysis.methods.map((method, methodIndex) => ({
            value: [methodIndex, groupIndex, group.methodCounts[method] ?? 0],
            displayName: group.label,
            framework: group.framework,
            kind: 'group' as const,
            routeCount: group.routeCount,
            method,
          }))),
          label: {
            show: routeAnalysis.groups.length <= 14,
            color: CHART_TEXT,
            formatter: params => {
              const value = typeof params === 'object' && params && 'data' in params ? (params.data as { value: [number, number, number] }).value?.[2] : null;
              return Number(value ?? 0) > 0 ? String(value) : '';
            },
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(115, 185, 255, 0.32)',
            },
          },
        },
      ]
      : chartVariant === 'stackedBar'
        ? routeAnalysis.methods.map(method => ({
          type: 'bar',
          name: methodLabel(method, t),
          stack: 'routes',
          itemStyle: { color: methodColor(method) },
          emphasis: { focus: 'series' },
          data: routeAnalysis.groups.map(group => ({
            value: group.methodCounts[method] ?? 0,
            displayName: group.label,
            framework: group.framework,
            kind: 'group' as const,
            routeCount: group.routeCount,
            method,
          })),
        }))
      : chartVariant === 'sankey'
      ? [
        {
          type: 'sankey',
          data: routeFlowGraph.nodes.map(node => ({
            ...node,
            value: node.routeCount,
            depth: node.kind === 'framework' ? 0 : node.kind === 'group' ? 1 : 2,
          })),
          links: routeFlowGraph.links,
          nodeWidth: 16,
          nodeGap: 16,
          draggable: false,
          emphasis: { focus: 'adjacency' },
          levels: [
            { depth: 0, itemStyle: { borderWidth: 2 }, lineStyle: { color: 'source', opacity: 0.28 } },
            { depth: 1, itemStyle: { borderWidth: 1.5 }, lineStyle: { color: 'source', opacity: 0.24 } },
            { depth: 2, itemStyle: { borderWidth: 1.5 }, lineStyle: { color: 'source', opacity: 0.22 } },
          ],
          lineStyle: {
            color: 'source',
            opacity: 0.26,
            curveness: 0.5,
          },
          label: {
            color: CHART_TEXT,
            fontSize: 12,
            formatter: params => {
              const data = typeof params === 'object' && params && 'data' in params ? params.data as RouteFlowNode : null;
              return data?.displayName ?? '';
            },
          },
        },
      ]
      : chartVariant === 'tree'
        ? [
          {
            type: 'tree',
            data: [routeHierarchy.root],
            layout: 'radial',
            top: '8%',
            left: '8%',
            bottom: '8%',
            right: '8%',
            symbol: 'circle',
            symbolSize: 10,
            roam: true,
            expandAndCollapse: true,
            initialTreeDepth: 2,
            animationDurationUpdate: 550,
            lineStyle: {
              color: 'rgba(115, 185, 255, 0.38)',
              width: 1.2,
              curveness: 0.28,
            },
            itemStyle: {
              borderWidth: 1.5,
            },
            label: {
              color: CHART_TEXT,
              fontSize: 12,
              formatter: params => {
                const data = typeof params === 'object' && params && 'data' in params ? params.data as RouteHierarchyNode : null;
                return data?.displayName ?? '';
              },
            },
            leaves: {
              label: {
                color: CHART_TEXT,
                fontSize: 11,
              },
            },
            emphasis: {
              focus: 'descendant',
            },
          },
        ]
        : chartVariant === 'sunburst'
          ? [
            {
              type: 'sunburst',
              data: routeHierarchy.root.children,
              radius: ['12%', '92%'],
              sort: undefined,
              nodeClick: false,
              emphasis: { focus: 'ancestor' },
              itemStyle: {
                borderColor: CHART_BORDER,
                borderWidth: 2,
              },
              label: {
                color: CHART_TEXT,
              },
              levels: [
                {},
                { r0: '12%', r: '32%', label: { rotate: 'tangential' } },
                { r0: '34%', r: '62%', label: { rotate: 'tangential' } },
                { r0: '64%', r: '92%', label: { rotate: 'radial' } },
              ],
            },
          ]
          : chartVariant === 'treemap'
            ? [
              {
                type: 'treemap',
                data: routeHierarchy.root.children,
                roam: false,
                nodeClick: false,
                breadcrumb: { show: false },
                label: {
                  show: true,
                  color: CHART_TEXT,
                  formatter: params => {
                    const data = typeof params === 'object' && params && 'data' in params ? params.data as RouteHierarchyNode : null;
                    return data?.displayName ?? '';
                  },
                },
                upperLabel: {
                  show: true,
                  color: CHART_TEXT,
                  height: 24,
                },
                itemStyle: {
                  borderColor: CHART_BORDER,
                  borderWidth: 2,
                  gapWidth: 2,
                },
                levels: [
                  { colorSaturation: [0.28, 0.42], itemStyle: { gapWidth: 4, borderColor: '#141922' } },
                  { colorSaturation: [0.22, 0.36], itemStyle: { gapWidth: 2, borderColor: '#1a212b' } },
                  { colorSaturation: [0.18, 0.28], itemStyle: { gapWidth: 1, borderColor: '#202834' } },
                ],
              },
            ]
      : [
        {
          type: 'graph',
          layout: chartVariant === 'circular' ? 'circular' : 'force',
          circular: chartVariant === 'circular' ? { rotateLabel: false } : undefined,
          data: routeFlowGraph.nodes,
          links: routeFlowGraph.links,
          categories: [
            { name: t('apiRoutes.framework') },
            { name: t('apiRoutes.pathPrefix') },
            { name: t('apiRoutes.methods') },
          ],
          roam: true,
          draggable: chartVariant !== 'circular',
          edgeSymbol: ['none', 'arrow'],
          edgeSymbolSize: [0, 8],
          force: chartVariant === 'force' ? {
            repulsion: 260,
            gravity: 0.08,
            edgeLength: [80, 180],
            friction: 0.55,
          } : undefined,
          emphasis: {
            itemStyle: {
              borderColor: '#ffffff',
              borderWidth: 2,
            },
            lineStyle: {
              width: 1.2,
              opacity: 0.32,
            },
          },
          lineStyle: {
            color: 'source',
            opacity: 0.32,
            width: 1.2,
            curveness: chartVariant === 'circular' ? 0.18 : 0.08,
          },
          label: {
            show: true,
            color: CHART_TEXT,
            fontSize: 12,
            overflow: 'truncate',
            width: chartVariant === 'circular' ? 130 : 150,
            formatter: params => {
              const data = typeof params === 'object' && params && 'data' in params ? params.data as RouteFlowNode : null;
              return data?.displayName ?? '';
            },
          },
        },
      ],
    textStyle: { color: CHART_MUTED },
  }), [chartVariant, locale, routeAnalysis, routeFlowGraph, routeHierarchy, t]);

  function handleRouteChartClick(data: RouteFlowNode | null): void {
    if (!data) return;
    if (data.kind === 'framework' && data.framework) {
      setFrameworkFilter(data.framework);
      setDisplayMode('list');
      return;
    }
    if (data.kind === 'group') {
      setSearchText(data.displayName);
      setFrameworkFilter(data.framework ?? 'all');
      setDisplayMode('list');
    }
  }

  useEffect(() => {
    if (visibleDepth == null) return;
    if (routeDepthMax === 0) {
      setVisibleDepth(null);
      return;
    }
    if (visibleDepth > routeDepthMax) setVisibleDepth(routeDepthMax);
  }, [routeDepthMax, visibleDepth]);

  if (!folder) return <div className="empty">{t('common.selectFolder')}</div>;

  return (
    <div className="api-routes-page">
      <PageHeader
        title={t('apiRoutes.title')}
        description={t('apiRoutes.subtitle')}
        actions={(
          <div className="api-routes-filters">
            <input
              value={searchText}
              onChange={event => setSearchText(event.target.value)}
              placeholder={t('apiRoutes.searchPlaceholder')}
            />
            <label className="page-select-field">
              <span>{t('apiRoutes.framework')}</span>
              <select value={frameworkFilter} onChange={event => setFrameworkFilter(event.target.value as 'all' | ApiRouteEntry['framework'])}>
                <option value="all">{t('apiRoutes.allFrameworks')}</option>
                {(overview?.frameworks ?? []).map(framework => (
                  <option key={framework} value={framework}>{frameworkLabel(framework, t)}</option>
                ))}
              </select>
            </label>
          </div>
        )}
      />

      {loading ? <EmptyState description={t('apiRoutes.loading')} /> : null}
      {!loading && overview && overview.routes.length === 0 ? <EmptyState description={t('apiRoutes.noData')} /> : null}

      {!loading && overview && overview.routes.length > 0 ? (
        <>
          <div className="cards api-routes-cards">
            <div className="card metric-card"><div className="label">{t('apiRoutes.routes')}</div><div className="value">{overview.routes.length.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('apiRoutes.frameworks')}</div><div className="value">{overview.frameworks.length.toLocaleString(locale)}</div></div>
            {overview.frameworks.some(fw => fw === 'laravel') && (
              <div className="card metric-card"><div className="label">{t('apiRoutes.laravelFiles')}</div><div className="value">{overview.laravelRouteFiles.toLocaleString(locale)}</div></div>
            )}
            {(overview.frameworks.includes('next-app') || overview.frameworks.includes('next-pages')) && (
              <div className="card metric-card"><div className="label">{t('apiRoutes.nextFiles')}</div><div className="value">{overview.nextRouteFiles.toLocaleString(locale)}</div></div>
            )}
          </div>

          {overview.warnings.length > 0 ? (
            <div className="api-routes-warning-list">
              {overview.warnings.map(warning => <div key={warning} className="settings-field-note">{translateApiRouteWarning(warning, t)}</div>)}
            </div>
          ) : null}

          <div className="api-routes-summary-bar">
            <div className="api-routes-summary">{t('apiRoutes.filteredCount', { shown: filteredRoutes.length, total: overview.routes.length })}</div>
            <div className="api-routes-toolbar-strip">
              <div className="api-routes-view-strip" aria-label={t('apiRoutes.viewMode')}>
                <button
                  type="button"
                  className={displayMode === 'list' ? 'api-routes-view-button active' : 'api-routes-view-button'}
                  aria-pressed={displayMode === 'list'}
                  onClick={() => setDisplayMode('list')}
                >
                  {displayModeLabel('list', t)}
                </button>
                <button
                  type="button"
                  className={displayMode === 'graph' ? 'api-routes-view-button active' : 'api-routes-view-button'}
                  aria-pressed={displayMode === 'graph'}
                  onClick={() => setDisplayMode('graph')}
                >
                  {displayModeLabel('graph', t)}
                </button>
              </div>

              {displayMode === 'graph' ? (
                <div className="api-routes-chart-strip" aria-label={t('apiRoutes.chartType')}>
                  <span className="muted">{t('apiRoutes.chartType')}</span>
                  <div className="api-routes-view-strip">
                    {(['force', 'circular', 'sankey', 'tree', 'sunburst', 'treemap', 'heatmap', 'stackedBar'] as RouteChartVariant[]).map(variant => (
                      <button
                        key={variant}
                        type="button"
                        className={chartVariant === variant ? 'api-routes-view-button api-routes-chart-button active' : 'api-routes-view-button api-routes-chart-button'}
                        aria-pressed={chartVariant === variant}
                        onClick={() => setChartVariant(variant)}
                      >
                        {routeChartVariantLabel(variant, t)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="api-routes-depth-strip" aria-label={t('apiRoutes.depth')}>
                <span className="muted">{t('apiRoutes.depth')}</span>
                <button
                  type="button"
                  className={visibleDepth == null ? 'api-routes-depth-button active' : 'api-routes-depth-button'}
                  aria-pressed={visibleDepth == null}
                  onClick={() => setVisibleDepth(null)}
                >
                  {t('common.all')}
                </button>
                {depthOptions.map(level => (
                  <button
                    key={level}
                    type="button"
                    className={visibleDepth === level ? 'api-routes-depth-button active' : 'api-routes-depth-button'}
                    aria-pressed={visibleDepth === level}
                    onClick={() => setVisibleDepth(level)}
                  >
                    {depthButtonLabel(level, t)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filteredRoutes.length === 0 ? <EmptyState description={t('apiRoutes.noMatches')} /> : null}

          {filteredRoutes.length > 0 ? (
            <>
              {displayMode === 'list' ? (
                <div className="api-routes-route-sections">
                  {routeSections.map(section => (
                    <section key={section.framework} className="api-routes-section">
                      <div className="api-routes-section-header">
                        <strong>{frameworkLabel(section.framework, t)}</strong>
                        <span className="status-pill">{section.routes.length.toLocaleString(locale)}</span>
                      </div>

                      {visibleDepth == null ? (
                        <RouteTable
                          routes={section.routes}
                          groupDepth={null}
                          locale={locale}
                          onOpen={sourceFile => navigate(`/editor/${encodeURIComponent(sourceFile)}`)}
                          t={t}
                        />
                      ) : (
                        <div className="api-routes-group-stack">
                          {section.groups.map(group => (
                            <div key={group.key} className="card api-routes-group-card">
                              <div className="api-routes-group-header">
                                <strong className="mono">{group.label}</strong>
                                <span className="status-pill">{group.routes.length.toLocaleString(locale)}</span>
                              </div>
                              <RouteTable
                                routes={group.routes}
                                groupDepth={visibleDepth}
                                locale={locale}
                                onOpen={sourceFile => navigate(`/editor/${encodeURIComponent(sourceFile)}`)}
                                t={t}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              ) : (
                <div className="api-routes-flow-stage">
                  <EChartsPanel
                    option={graphOption}
                    style={{ height: chartHeight }}
                    onEvents={{
                      mouseover: (params, chart) => {
                        if (chartVariant !== 'force' && chartVariant !== 'circular') return;
                        const payload = typeof params === 'object' && params && 'dataType' in params ? params as { dataType?: string; dataIndex?: number } : null;
                        if (!payload || payload.dataType !== 'edge') return;
                        chart.dispatchAction({ type: 'downplay', seriesIndex: 0, dataType: 'edge', dataIndex: payload.dataIndex });
                        chart.dispatchAction({ type: 'hideTip' });
                      },
                      click: params => {
                        const data = typeof params === 'object' && params && 'data' in params ? params.data as RouteFlowNode : null;
                        handleRouteChartClick(data);
                      },
                    }}
                  />
                </div>
              )}

              <div className="api-routes-chart-meta">
                <span>
                  {displayMode === 'graph'
                    ? t('apiRoutes.graphSummary', { shown: filteredRoutes.length, count: routeFlowGraph.groupDepth, groups: routeFlowGraph.groupCount, chart: routeChartVariantLabel(chartVariant, t) })
                    : visibleDepth == null
                      ? t('apiRoutes.listSummary', { shown: filteredRoutes.length })
                      : t('apiRoutes.groupSummary', { shown: filteredRoutes.length, count: visibleDepth })}
                </span>
                <span>{displayMode === 'graph' ? t('apiRoutes.graphHint') : t('apiRoutes.listHint')}</span>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}