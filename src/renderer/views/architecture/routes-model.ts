import type { ApiRouteEntry, ApiRouteOverview } from '../../../shared/api';
import type { TranslationKey } from '../../i18n';

/**
 * The pure route model behind the Routes lens. Extracted verbatim from the
 * 1375-line `pages/ApiRoutesView.tsx` so the list renderer
 * (`ApiRoutesList.tsx`) and the chart variants (`ApiRoutesGraph.tsx`) can
 * be split apart without either of them owning the other's data shaping
 * (blueprint §6 chunk 8 / ADOPTION §1.4).
 *
 * Nothing here knows about colour any more: the old `FRAMEWORK_COLORS` /
 * `METHOD_COLORS` / `CHART_*` hex blocks baked `itemStyle` into every node.
 * Colour is now assigned at option-build time from `ChartTokens`, which is what
 * makes the charts theme-aware (DESIGN-SYSTEM §1.6).
 */
export type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

export type DisplayMode = 'list' | 'graph';

export type RouteChartVariant =
  | 'force'
  | 'sankey'
  | 'treemap'
  | 'heatmap'
  | 'stackedBar';

export const ROUTE_CHART_VARIANTS: RouteChartVariant[] = [
  'stackedBar', 'heatmap', 'treemap', 'sankey', 'force',
];

export const ROUTE_METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'PAGE', 'ANY'];
export const VISIBLE_ANALYSIS_GROUPS = 20;

/**
 * Variants whose marks are placed by a layout pass, so "Re-layout graph" has
 * something to do. Heatmap and stacked bar are axis-bound.
 */
export const RELAYOUTABLE_VARIANTS: RouteChartVariant[] = ['force', 'sankey'];

export type RouteNodeKind = 'root' | 'framework' | 'group' | 'method';

export interface RouteFlowNode {
  name: string;
  displayName: string;
  kind: RouteNodeKind;
  framework?: ApiRouteEntry['framework'];
  method?: string;
  routeCount: number;
  /** Route-method pairs; a multi-method route contributes once per method. */
  methodCount?: number;
  methods?: string[];
  sourceCount?: number;
  symbolSize?: number;
  category?: number;
}

export interface RouteHierarchyNode extends RouteFlowNode {
  value: number;
  children?: RouteHierarchyNode[];
}

export interface RouteHierarchyChart {
  groupDepth: number;
  groupCount: number;
  root: RouteHierarchyNode;
  chartHeight: number;
}

export interface RouteFlowLink {
  source: string;
  target: string;
  value: number;
}

export interface RouteFlowGraph {
  groupDepth: number;
  groupCount: number;
  nodes: RouteFlowNode[];
  links: RouteFlowLink[];
  chartHeight: number;
}

export interface RouteAnalysisGroup {
  key: string;
  framework: ApiRouteEntry['framework'];
  label: string;
  displayName: string;
  routeCount: number;
  methodCount: number;
  sourceCount: number;
  methodCounts: Record<string, number>;
}

export interface RouteAnalysisChart {
  groupDepth: number;
  groupCount: number;
  groups: RouteAnalysisGroup[];
  methods: string[];
  maxValue: number;
  chartHeight: number;
}

export interface RouteGroup {
  key: string;
  label: string;
  routes: ApiRouteEntry[];
}

export interface RouteChartGroupFilter {
  framework: ApiRouteEntry['framework'];
  prefix: string;
  depth: number;
}

export interface FrameworkRouteSection {
  framework: ApiRouteEntry['framework'];
  routes: ApiRouteEntry[];
  groups: RouteGroup[];
}

export const LARAVEL_GROUP_BEST_EFFORT_WARNING =
  'Laravel route groups are expanded best-effort; dynamic group attributes or runtime-defined routes can still be incomplete.';

export function emptyOverview(): ApiRouteOverview {
  return { frameworks: [], routes: [], laravelRouteFiles: 0, nextRouteFiles: 0, warnings: [] };
}

export function frameworkLabel(framework: ApiRouteEntry['framework'], t: Translate): string {
  if (framework === 'laravel') return t('apiRoutes.frameworkLaravel');
  if (framework === 'next-app') return t('apiRoutes.frameworkNextApp');
  return t('apiRoutes.frameworkNextPages');
}

export function methodLabel(method: string, t: Translate): string {
  if (method === 'PAGE') return t('apiRoutes.pageType');
  return method;
}

export function displayModeLabel(mode: DisplayMode, t: Translate): string {
  return mode === 'graph' ? t('apiRoutes.viewGraph') : t('apiRoutes.viewList');
}

export function depthButtonLabel(level: number, t: Translate): string {
  return t('apiRoutes.depthLevel', { count: level });
}

export function routeChartVariantLabel(variant: RouteChartVariant, t: Translate): string {
  if (variant === 'heatmap') return t('apiRoutes.chartHeatmap');
  if (variant === 'sankey') return t('apiRoutes.chartSankey');
  if (variant === 'stackedBar') return t('apiRoutes.chartStackedBar');
  if (variant === 'treemap') return t('apiRoutes.chartTreemap');
  return t('apiRoutes.chartForce');
}

export function splitRouteSegments(routePath: string): string[] {
  return routePath.split('/').filter(Boolean);
}

export function maxRoutePathDepth(routes: ApiRouteEntry[]): number {
  return routes.reduce((maxDepth, route) => Math.max(maxDepth, splitRouteSegments(route.path).length), 0);
}

export function prefixPath(routePath: string, depth: number): string {
  const segments = splitRouteSegments(routePath).slice(0, depth);
  return segments.length > 0 ? `/${segments.join('/')}` : '/';
}

export function matchesRouteChartGroup(route: ApiRouteEntry, group: RouteChartGroupFilter): boolean {
  return route.framework === group.framework && prefixPath(route.path, group.depth) === group.prefix;
}

export function tailPath(routePath: string, depth: number | null): string {
  if (depth == null) return routePath;

  const segments = splitRouteSegments(routePath);
  if (segments.length <= depth) return '/';
  return `/${segments.slice(depth).join('/')}`;
}

export function routeKey(route: ApiRouteEntry): string {
  return [route.framework, route.path, route.handler, route.sourceFile, route.routeName ?? '', route.methods.join(',')].join('|');
}

export function translateApiRouteWarning(warning: string, t: Translate): string {
  const missingIncludedFilesMatch = warning.match(/^Laravel included route files were referenced but not found in the scan:\s*(.+)$/);
  if (missingIncludedFilesMatch?.[1]) {
    return t('apiRoutes.warningMissingIncludedFiles', { value: missingIncludedFilesMatch[1] });
  }

  return warning;
}

export function frameworkNodeId(framework: ApiRouteEntry['framework']): string {
  return `framework:${framework}`;
}

export function groupNodeId(framework: ApiRouteEntry['framework'], groupLabel: string): string {
  return `group:${framework}:${groupLabel}`;
}

export function methodNodeId(method: string): string {
  return `method:${method.toUpperCase()}`;
}

function routeMethods(route: ApiRouteEntry): string[] {
  return Array.from(new Set(route.methods.map(method => method.toUpperCase())));
}

export function buildRouteSections(routes: ApiRouteEntry[], groupDepth: number | null): FrameworkRouteSection[] {
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

export function buildRouteFlowGraph(routes: ApiRouteEntry[], groupDepth: number, t: Translate): RouteFlowGraph {
  const frameworkCounts = new Map<ApiRouteEntry['framework'], { routes: number; methods: number }>();
  const groups = new Map<string, { framework: ApiRouteEntry['framework']; label: string; routeCount: number; methodCount: number; methods: Set<string>; sourceFiles: Set<string> }>();
  const methodCounts = new Map<string, number>();
  const groupMethodCounts = new Map<string, { framework: ApiRouteEntry['framework']; label: string; method: string; count: number }>();

  for (const route of routes) {
    const methods = routeMethods(route);
    const frameworkCount = frameworkCounts.get(route.framework) ?? { routes: 0, methods: 0 };
    frameworkCount.routes += 1;
    frameworkCount.methods += methods.length;
    frameworkCounts.set(route.framework, frameworkCount);

    const label = prefixPath(route.path, groupDepth);
    const key = `${route.framework}|${label}`;
    const existing = groups.get(key) ?? {
      framework: route.framework,
      label,
      routeCount: 0,
      methodCount: 0,
      methods: new Set<string>(),
      sourceFiles: new Set<string>(),
    };

    existing.routeCount += 1;
    existing.methodCount += methods.length;
    methods.forEach(normalizedMethod => {
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
    .map(([framework, counts]) => ({
      name: frameworkNodeId(framework),
      displayName: frameworkLabel(framework, t),
      kind: 'framework' as const,
      framework,
      routeCount: counts.routes,
      methodCount: counts.methods,
      category: 0,
      symbolSize: 42 + Math.min(26, Math.sqrt(counts.routes) * 4),
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
      methodCount: entry.methodCount,
      methods: Array.from(entry.methods).sort(),
      sourceCount: entry.sourceFiles.size,
      category: 1,
      symbolSize: 22 + Math.min(32, Math.sqrt(entry.routeCount) * 5),
    });
    links.push({
      source: frameworkNodeId(entry.framework),
      target: nodeId,
      value: entry.methodCount,
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
    chartHeight: Math.max(440, Math.min(800, 360 + (groupEntries.length * 8))),
  };
}

export function buildRouteHierarchy(routes: ApiRouteEntry[], groupDepth: number, t: Translate): RouteHierarchyChart {
  const frameworkNodes = new Map<ApiRouteEntry['framework'], RouteHierarchyNode>();
  const groupNodes = new Map<string, RouteHierarchyNode>();
  const groupMethods = new Map<string, Set<string>>();
  const groupSources = new Map<string, Set<string>>();

  const root: RouteHierarchyNode = {
    name: 'root',
    displayName: t('apiRoutes.treeRoot'),
    kind: 'root',
    routeCount: routes.length,
    value: routes.length,
    children: [],
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
      sourceCount: 0,
    };

    if (!groupNodes.has(groupKey)) {
      groupNodes.set(groupKey, groupNode);
      groupMethods.set(groupKey, new Set<string>());
      groupSources.set(groupKey, new Set<string>());
      frameworkNode.children?.push(groupNode);
    }

    groupNode.routeCount += 1;
    groupNode.value = groupNode.routeCount;

    const methods = groupMethods.get(groupKey)!;
    routeMethods(route).forEach(method => methods.add(method));
    groupNode.methods = Array.from(methods).sort();
    const sources = groupSources.get(groupKey)!;
    sources.add(route.sourceFile);
    groupNode.sourceCount = sources.size;
  }

  root.children = (root.children ?? [])
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map(frameworkNode => ({
      ...frameworkNode,
      children: (frameworkNode.children ?? [])
        .sort((left, right) => right.routeCount - left.routeCount || left.displayName.localeCompare(right.displayName)),
    }));

  return {
    groupDepth,
    groupCount: groupNodes.size,
    root,
    chartHeight: Math.max(440, Math.min(720, 360 + (groupNodes.size * 10))),
  };
}

export function buildRouteAnalysisChart(routes: ApiRouteEntry[], groupDepth: number, t: Translate): RouteAnalysisChart {
  const groupMap = new Map<string, {
    framework: ApiRouteEntry['framework'];
    label: string;
    routeCount: number;
    methodCount: number;
    methodCounts: Map<string, number>;
    sourceFiles: Set<string>;
  }>();
  const methods = new Set<string>();

  for (const route of routes) {
    const label = prefixPath(route.path, groupDepth);
    const key = `${route.framework}|${label}`;
    const entry = groupMap.get(key) ?? {
      framework: route.framework,
      label,
      routeCount: 0,
      methodCount: 0,
      methodCounts: new Map<string, number>(),
      sourceFiles: new Set<string>(),
    };

    entry.routeCount += 1;
    entry.sourceFiles.add(route.sourceFile);
    routeMethods(route).forEach(normalizedMethod => {
      methods.add(normalizedMethod);
      entry.methodCount += 1;
      entry.methodCounts.set(normalizedMethod, (entry.methodCounts.get(normalizedMethod) ?? 0) + 1);
    });

    groupMap.set(key, entry);
  }

  const methodList = Array.from(methods).sort((left, right) => {
    const rank = (method: string) => {
      const index = ROUTE_METHOD_ORDER.indexOf(method);
      return index < 0 ? ROUTE_METHOD_ORDER.length : index;
    };
    return rank(left) - rank(right) || left.localeCompare(right);
  });
  const groups = Array.from(groupMap.entries())
    .sort((left, right) => right[1].methodCount - left[1].methodCount || left[1].framework.localeCompare(right[1].framework) || left[1].label.localeCompare(right[1].label))
    .map(([key, entry]) => ({
      key,
      framework: entry.framework,
      label: entry.label,
      displayName: `${frameworkLabel(entry.framework, t)} · ${entry.label}`,
      routeCount: entry.routeCount,
      methodCount: entry.methodCount,
      sourceCount: entry.sourceFiles.size,
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
    chartHeight: Math.max(360, 120 + (Math.min(groups.length, VISIBLE_ANALYSIS_GROUPS) * 28)),
  };
}
