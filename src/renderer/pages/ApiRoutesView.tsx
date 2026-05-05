import React, { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { useNavigate } from 'react-router-dom';
import type { ApiRouteEntry, ApiRouteOverview, FolderRow } from '../../shared/api';
import EChartsPanel from '../components/EChartsPanel';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import { useI18n } from '../i18n';

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
  value?: number;
  itemStyle?: { color?: string; borderColor?: string; borderWidth?: number };
  lineStyle?: { color?: string; width?: number; opacity?: number };
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

function leafLabel(route: ApiRouteEntry, t: ReturnType<typeof useI18n>['t']): string {
  return route.methods.map(method => methodLabel(method, t)).join(' / ');
}

function ensureChild(parent: RouteTreeNode, name: string, nodeType: RouteTreeNode['nodeType'], color: string, fullPath?: string): RouteTreeNode {
  parent.children ??= [];
  const existing = parent.children.find(child => child.name === name && child.nodeType === nodeType);
  if (existing) return existing;

  const nextNode: RouteTreeNode = {
    name,
    nodeType,
    routeCount: 0,
    fullPath,
    itemStyle: nodeType === 'route'
      ? { color, borderColor: color, borderWidth: 1.5 }
      : { color },
    lineStyle: { color, width: 1.1, opacity: 0.7 },
  };
  parent.children.push(nextNode);
  return nextNode;
}

function sortTree(node: RouteTreeNode) {
  if (!node.children) return;
  node.children.sort((left, right) => {
    if (left.nodeType !== right.nodeType) {
      if (left.nodeType === 'route') return 1;
      if (right.nodeType === 'route') return -1;
    }
    return left.name.localeCompare(right.name);
  });
  node.children.forEach(sortTree);
}

function countNodes(node: RouteTreeNode): number {
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);
}

function buildRouteTree(routes: ApiRouteEntry[], t: ReturnType<typeof useI18n>['t']): RouteTreeNode {
  const root: RouteTreeNode = {
    name: t('apiRoutes.treeRoot'),
    nodeType: 'root',
    routeCount: routes.length,
    itemStyle: { color: '#4b5563' },
    lineStyle: { color: '#4b5563', width: 1.1, opacity: 0.5 },
    children: [],
  };

  for (const route of routes) {
    const color = FRAMEWORK_COLORS[route.framework];
    const frameworkNode = ensureChild(root, frameworkLabel(route.framework, t), 'framework', color);
    frameworkNode.framework = route.framework;
    frameworkNode.routeCount += 1;

    let currentNode = frameworkNode;
    const segments = route.path.split('/').filter(Boolean);

    if (segments.length === 0) {
      currentNode = ensureChild(frameworkNode, '/', 'segment', color, '/');
      currentNode.routeCount += 1;
    } else {
      let currentPath = '';
      for (const segment of segments) {
        currentPath = `${currentPath}/${segment}`;
        currentNode = ensureChild(currentNode, segment, 'segment', color, currentPath);
        currentNode.routeCount += 1;
      }
    }

    const routeNode = ensureChild(currentNode, leafLabel(route, t), 'route', color, route.path);
    routeNode.framework = route.framework;
    routeNode.sourceFile = route.sourceFile;
    routeNode.methods = route.methods;
    routeNode.handler = route.handler;
    routeNode.routeName = route.routeName;
    routeNode.routeCount += 1;
    routeNode.value = 1;
  }

  sortTree(root);
  return root;
}

export default function ApiRoutesView({ folder, scanRevision }: Props) {
  const [overview, setOverview] = useState<ApiRouteOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [frameworkFilter, setFrameworkFilter] = useState<'all' | ApiRouteEntry['framework']>('all');
  const [searchText, setSearchText] = useState('');
  const navigate = useNavigate();
  const { locale, t } = useI18n();

  useEffect(() => {
    let ignore = false;

    if (!folder) {
      setOverview(null);
      setLoading(false);
      return () => { ignore = true; };
    }

    setLoading(true);
    void window.api.stats.apiRoutes(folder.id).then(nextOverview => {
      if (ignore) return;
      setOverview(nextOverview);
      setLoading(false);
    }).catch(() => {
      if (ignore) return;
      setOverview(emptyOverview());
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

  const routeTree = useMemo(() => buildRouteTree(filteredRoutes, t), [filteredRoutes, t]);
  const chartHeight = useMemo(() => Math.min(1400, Math.max(420, countNodes(routeTree) * 26)), [routeTree]);
  const chartOption = useMemo<EChartsOption>(() => ({
    animationDuration: 500,
    tooltip: {
      trigger: 'item',
      backgroundColor: CHART_TOOLTIP_BACKGROUND,
      borderColor: CHART_BORDER,
      textStyle: { color: CHART_TEXT },
      formatter: params => {
        const data = typeof params === 'object' && params && 'data' in params ? params.data as RouteTreeNode : null;
        if (!data) return '';

        if (data.nodeType === 'route') {
          const lines = [
            data.fullPath ?? '/',
            `${t('apiRoutes.framework')}: ${data.framework ? frameworkLabel(data.framework, t) : '-'}`,
            `${t('apiRoutes.methods')}: ${(data.methods ?? []).map(method => methodLabel(method, t)).join(' / ')}`,
            `${t('apiRoutes.source')}: ${data.sourceFile ?? '-'}`,
          ];

          if (data.handler && data.handler !== 'page component') lines.push(`${t('apiRoutes.handler')}: ${data.handler}`);
          if (data.routeName) lines.push(`${t('apiRoutes.routeName')}: ${data.routeName}`);
          return lines.join('<br/>');
        }

        const title = data.nodeType === 'framework' ? data.name : (data.fullPath ?? data.name);
        return [
          title,
          `${t('apiRoutes.routes')}: ${Number(data.routeCount).toLocaleString(locale)}`,
        ].join('<br/>');
      },
    },
    series: [
      {
        type: 'tree',
        data: [routeTree],
        top: 16,
        left: 16,
        bottom: 16,
        right: 240,
        layout: 'orthogonal',
        orient: 'LR',
        symbol: 'circle',
        symbolSize: 9,
        roam: true,
        expandAndCollapse: true,
        initialTreeDepth: -1,
        animationDurationUpdate: 550,
        emphasis: { focus: 'descendant' },
        lineStyle: { color: '#4b5563', width: 1.1, curveness: 0.5 },
        label: {
          position: 'left',
          verticalAlign: 'middle',
          align: 'right',
          color: CHART_TEXT,
          fontSize: 12,
          distance: 8,
        },
        leaves: {
          label: {
            position: 'right',
            verticalAlign: 'middle',
            align: 'left',
            color: CHART_TEXT,
            fontSize: 12,
          },
        },
      },
    ],
    textStyle: { color: CHART_MUTED },
  }), [locale, routeTree, t]);

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
            <div className="card metric-card"><div className="label">{t('apiRoutes.laravelFiles')}</div><div className="value">{overview.laravelRouteFiles.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('apiRoutes.nextFiles')}</div><div className="value">{overview.nextRouteFiles.toLocaleString(locale)}</div></div>
          </div>

          {overview.warnings.length > 0 ? (
            <div className="api-routes-warning-list">
              {overview.warnings.map(warning => <div key={warning} className="settings-field-note">{warning}</div>)}
            </div>
          ) : null}

          <div className="api-routes-summary">{t('apiRoutes.filteredCount', { shown: filteredRoutes.length, total: overview.routes.length })}</div>

          {filteredRoutes.length === 0 ? <EmptyState description={t('apiRoutes.noMatches')} /> : null}

          {filteredRoutes.length > 0 ? (
            <>
              <div className="chart-box api-routes-chart-box">
                <EChartsPanel
                  option={chartOption}
                  style={{ height: chartHeight }}
                  onEvents={{
                    click: params => {
                      const sourceFile = typeof params === 'object' && params && 'data' in params
                        && typeof params.data === 'object' && params.data && 'nodeType' in params.data && params.data.nodeType === 'route'
                        && 'sourceFile' in params.data && params.data.sourceFile
                        ? String(params.data.sourceFile)
                        : null;
                      if (sourceFile) navigate(`/editor/${encodeURIComponent(sourceFile)}`);
                    },
                  }}
                />
              </div>

              <div className="api-routes-chart-meta">
                <span>{t('apiRoutes.treeSummary', { shown: filteredRoutes.length })}</span>
                <span>{t('apiRoutes.treeHint')}</span>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}