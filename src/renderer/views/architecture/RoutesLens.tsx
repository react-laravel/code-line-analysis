import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ApiRouteEntry, ApiRouteOverview } from '../../../shared/api';
import {
  Button,
  DropdownMenu,
  EmptyState,
  Panel,
  Select,
  Spinner,
  ToggleGroup,
  type MenuItem,
} from '../../components/ui';
import { ChevronDown } from 'lucide-react';
import ScanNowButton from '../../components/ScanNowButton';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { useI18n } from '../../i18n';
import { useRevision } from '../../store/app-store';
import ApiRoutesList from './ApiRoutesList';
import ApiRoutesGraph from './ApiRoutesGraph';
import {
  ArchMetrics,
  ArchMetricsText,
  useGraphMenu,
  type ArchLens,
  type ArchLensArgs,
  type ArchMetric,
  type ChartEvents,
} from './lens';
import {
  buildRouteAnalysisChart,
  buildRouteFlowGraph,
  buildRouteHierarchy,
  buildRouteSections,
  depthButtonLabel,
  displayModeLabel,
  emptyOverview,
  frameworkLabel,
  LARAVEL_GROUP_BEST_EFFORT_WARNING,
  maxRoutePathDepth,
  matchesRouteChartGroup,
  RELAYOUTABLE_VARIANTS,
  ROUTE_CHART_VARIANTS,
  routeChartVariantLabel,
  translateApiRouteWarning,
  type DisplayMode,
  type RouteChartVariant,
  type RouteFlowNode,
  type RouteChartGroupFilter,
} from './routes-model';

/**
 * The Routes lens (was `/api-routes`, 1375 lines). The page's own chrome —
 * a search box, a framework `Select`, a List/Graph strip, a chart
 * strip and a depth strip — collapses into the Architecture toolbar: the
 * chart variants live in the "View as ▾" menu, depth lives in the
 * filters row, and the four metric tiles fold into the toolbar subtitle under
 * 1200px (blueprint §2.4).
 */
export function useRoutesLens({ folder, query, setQuery, active }: ArchLensArgs): ArchLens {
  const revision = useRevision();
  const { locale, t } = useI18n();
  const navigate = useNavigate();

  const [frameworkFilter, setFrameworkFilter] = useState<'all' | ApiRouteEntry['framework']>('all');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('list');
  const [chartVariant, setChartVariant] = useState<RouteChartVariant>('stackedBar');
  const [visibleDepth, setVisibleDepth] = useState<number | null>(null);
  const [chartGroupFilter, setChartGroupFilter] = useState<RouteChartGroupFilter | null>(null);

  const folderId = folder.id;
  const loadOverview = useCallback(() => window.api.stats.apiRoutes(folderId), [folderId]);
  const overviewErrorData = useCallback(() => emptyOverview(), []);
  const { data: overview, loading } = useAsyncResource<ApiRouteOverview | null>({
    resourceKey: folderId,
    refreshToken: revision,
    enabled: active,
    initialData: null,
    load: loadOverview,
    errorData: overviewErrorData,
  });

  useEffect(() => {
    setVisibleDepth(null);
    setChartGroupFilter(null);
  }, [folderId]);

  useEffect(() => {
    if (chartGroupFilter && query !== chartGroupFilter.prefix) setChartGroupFilter(null);
  }, [chartGroupFilter, query]);

  useEffect(() => {
    if (!overview) return;
    setVisibleDepth(overview.routes.length > 120
      ? Math.min(2, Math.max(maxRoutePathDepth(overview.routes), 1))
      : null);
  }, [overview]);

  const filteredRoutes = useMemo(() => {
    const normalizedSearch = query.trim().toLowerCase();
    return (overview?.routes ?? []).filter(route => {
      if (frameworkFilter !== 'all' && route.framework !== frameworkFilter) return false;
      if (chartGroupFilter && query === chartGroupFilter.prefix && !matchesRouteChartGroup(route, chartGroupFilter)) return false;
      if (!normalizedSearch) return true;
      return [route.path, route.handler, route.sourceFile, route.routeName ?? '', route.methods.join(' ')]
        .some(value => value.toLowerCase().includes(normalizedSearch));
    });
  }, [chartGroupFilter, frameworkFilter, overview?.routes, query]);

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
    if (chartVariant === 'heatmap' || chartVariant === 'stackedBar') return routeAnalysis.chartHeight;
    if (chartVariant === 'sankey') return Math.max(440, Math.min(980, 280 + (routeFlowGraph.groupCount * 24)));
    if (chartVariant === 'treemap') return routeHierarchy.chartHeight;
    return routeFlowGraph.chartHeight;
  }, [chartVariant, routeAnalysis.chartHeight, routeFlowGraph.chartHeight, routeFlowGraph.groupCount, routeHierarchy.chartHeight]);

  useEffect(() => {
    if (visibleDepth == null) return;
    if (routeDepthMax === 0) {
      setVisibleDepth(null);
      return;
    }
    if (visibleDepth > routeDepthMax) setVisibleDepth(routeDepthMax);
  }, [routeDepthMax, visibleDepth]);

  const handleRouteChartClick = useCallback((data: RouteFlowNode | null): void => {
    if (!data) return;
    if (data.kind === 'framework' && data.framework) {
      setChartGroupFilter(null);
      setFrameworkFilter(data.framework);
      setDisplayMode('list');
      return;
    }
    if (data.kind === 'group' && data.framework) {
      // Preserve exact group membership; substring search would include
      // /api/orders-export when the user clicks /api/orders.
      setChartGroupFilter({ framework: data.framework, prefix: data.displayName, depth: graphGroupDepth });
      setQuery(data.displayName);
      setFrameworkFilter(data.framework);
      setDisplayMode('list');
    }
  }, [graphGroupDepth, setQuery]);

  const chartEvents = useMemo<ChartEvents>(() => ({
    click: params => {
      const data = typeof params === 'object' && params && 'data' in params ? params.data as RouteFlowNode : null;
      handleRouteChartClick(data);
    },
  }), [handleRouteChartClick]);

  const activeFilterCount = [
    query.trim() !== '',
    frameworkFilter !== 'all',
    visibleDepth != null,
  ].filter(Boolean).length;

  const resetFilters = useCallback(() => {
    setQuery('');
    setFrameworkFilter('all');
    setVisibleDepth(null);
    setChartGroupFilter(null);
  }, [setQuery]);

  const graphData = useCallback(
    () => {
      if (displayMode === 'list') return { routes: filteredRoutes };
      if (chartVariant === 'heatmap' || chartVariant === 'stackedBar') return routeAnalysis;
      if (chartVariant === 'treemap') return routeHierarchy.root;
      return { nodes: routeFlowGraph.nodes, links: routeFlowGraph.links };
    },
    [chartVariant, displayMode, filteredRoutes, routeAnalysis, routeFlowGraph, routeHierarchy.root],
  );

  const menu = useGraphMenu({
    graph: displayMode === 'graph',
    relayoutable: RELAYOUTABLE_VARIANTS.includes(chartVariant),
    fileName: `routes-${chartVariant}`,
    data: graphData,
    onReset: resetFilters,
    resetDisabled: activeFilterCount === 0,
    chartEvents,
  });

  const chartCtx = useMemo(() => ({
    variant: chartVariant,
    flow: routeFlowGraph,
    hierarchy: routeHierarchy,
    analysis: routeAnalysis,
    locale,
    t,
    seed: menu.seed,
  }), [chartVariant, locale, menu.seed, routeAnalysis, routeFlowGraph, routeHierarchy, t]);

  const variantItems = useMemo<MenuItem[]>(
    () => ROUTE_CHART_VARIANTS.map(variant => ({
      kind: 'checkbox' as const,
      id: variant,
      label: routeChartVariantLabel(variant, t),
      checked: variant === chartVariant,
      onSelect: () => setChartVariant(variant),
    })),
    [chartVariant, t],
  );

  const metrics: ArchMetric[] = overview && overview.routes.length > 0
    ? [
      { label: t('apiRoutes.routes'), value: overview.routes.length.toLocaleString(locale) },
      { label: t('apiRoutes.frameworks'), value: overview.frameworks.length.toLocaleString(locale) },
      ...(overview.frameworks.includes('laravel')
        ? [{ label: t('apiRoutes.laravelFiles'), value: overview.laravelRouteFiles.toLocaleString(locale) }]
        : []),
      ...(overview.frameworks.includes('next-app') || overview.frameworks.includes('next-pages')
        ? [{ label: t('apiRoutes.nextFiles'), value: overview.nextRouteFiles.toLocaleString(locale) }]
        : []),
    ]
    : [];

  const visibleWarnings = (overview?.warnings ?? []).filter(warning => warning !== LARAVEL_GROUP_BEST_EFFORT_WARNING);

  const actions = (
    <>
      <ToggleGroup
        aria-label={t('apiRoutes.viewMode')}
        className="shrink-0 flex-nowrap"
        value={displayMode}
        onValueChange={setDisplayMode}
        options={[
          { value: 'list', label: displayModeLabel('list', t) },
          { value: 'graph', label: displayModeLabel('graph', t) },
        ]}
      />
      {displayMode === 'graph' ? (
        <DropdownMenu
          items={variantItems}
          align="end"
          trigger={(
            <Button size="sm" trailingIcon={ChevronDown}>
              {t('architecture.viewAs', { value: routeChartVariantLabel(chartVariant, t) })}
            </Button>
          )}
        />
      ) : null}
    </>
  );

  const filters = (
    <>
      <span className="text-xs text-fg-muted">{t('apiRoutes.framework')}</span>
      <Select
        size="sm"
        wrapperClassName="w-52"
        aria-label={t('apiRoutes.framework')}
        value={frameworkFilter}
        onChange={event => {
          setChartGroupFilter(null);
          setFrameworkFilter(event.target.value as 'all' | ApiRouteEntry['framework']);
        }}
        options={[
          { value: 'all', label: t('apiRoutes.allFrameworks') },
          ...(overview?.frameworks ?? []).map(framework => ({
            value: framework,
            label: frameworkLabel(framework, t),
          })),
        ]}
      />
      <span className="ml-1 text-xs text-fg-muted">{t('apiRoutes.depth')}</span>
      <ToggleGroup
        aria-label={t('apiRoutes.depth')}
        value={visibleDepth == null ? 'all' : String(visibleDepth)}
        onValueChange={value => setVisibleDepth(value === 'all' ? null : Number(value))}
        options={[
          { value: 'all', label: t('common.all') },
          ...depthOptions.map(level => ({ value: String(level), label: depthButtonLabel(level, t) })),
        ]}
      />
    </>
  );

  const content = (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-10">
          <Spinner size="md" label={t('apiRoutes.loading')} />
        </div>
      ) : null}

      {!loading && overview && overview.routes.length === 0 ? (
        <EmptyState
          title={t('common.noData')}
          description={t('apiRoutes.noData')}
          action={<ScanNowButton folderId={folderId} disabled={!folder.isAvailable} />}
        />
      ) : null}

      {!loading && overview && overview.routes.length > 0 ? (
        <>
          {visibleWarnings.length > 0 ? (
            <Panel tone="danger">
              <div role="alert" className="grid gap-1.5">
                {visibleWarnings.map(warning => (
                  <p key={warning} className="m-0 text-xs text-danger-text">{translateApiRouteWarning(warning, t)}</p>
                ))}
              </div>
            </Panel>
          ) : null}

          <ArchMetrics items={metrics} />

          {filteredRoutes.length === 0 ? (
            <EmptyState
              variant="no-results"
              title={t('common.noResults')}
              description={t('apiRoutes.noMatches')}
              action={<Button variant="primary" onClick={resetFilters}>{t('files.clearFilters')}</Button>}
            />
          ) : (
            <>
              {displayMode === 'list' ? (
                <ApiRoutesList
                  sections={routeSections}
                  visibleDepth={visibleDepth}
                  locale={locale}
                  onOpen={sourceFile => navigate(`/editor/${encodeURIComponent(sourceFile)}`)}
                  t={t}
                />
              ) : (
                <ApiRoutesGraph ctx={chartCtx} height={chartHeight} onEvents={menu.onEvents} />
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-fg-muted">
                <span>
                  {displayMode === 'graph'
                    ? t('apiRoutes.graphSummary', {
                      shown: filteredRoutes.length,
                      count: routeFlowGraph.groupDepth,
                      groups: routeFlowGraph.groupCount,
                      chart: routeChartVariantLabel(chartVariant, t),
                    })
                    : visibleDepth == null
                      ? t('apiRoutes.listSummary', { shown: filteredRoutes.length })
                      : t('apiRoutes.groupSummary', { shown: filteredRoutes.length, count: visibleDepth })}
                </span>
                <span>{displayMode === 'graph' ? t('apiRoutes.graphHint') : t('apiRoutes.listHint')}</span>
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );

  return {
    count: overview?.routes.length,
    actions,
    filters,
    overflow: menu.items,
    // "View as ▾" and the palette share the same available renderings by
    // name, plus List / Graph itself (blueprint §2.8).
    commands: [
      {
        kind: 'submenu',
        id: 'view-mode',
        label: t('apiRoutes.viewMode'),
        items: (['list', 'graph'] as const).map(mode => ({
          kind: 'checkbox' as const,
          id: mode,
          label: displayModeLabel(mode, t),
          checked: mode === displayMode,
          onSelect: () => setDisplayMode(mode),
        })),
      },
      {
        kind: 'submenu',
        id: 'view-as',
        label: t('palette.chartVariant'),
        items: ROUTE_CHART_VARIANTS.map(variant => ({
          kind: 'checkbox' as const,
          id: variant,
          label: routeChartVariantLabel(variant, t),
          checked: displayMode === 'graph' && variant === chartVariant,
          // Choosing a rendering by name implies switching to the graph.
          onSelect: () => {
            setDisplayMode('graph');
            setChartVariant(variant);
          },
        })),
      },
    ],
    searchPlaceholder: t('apiRoutes.searchPlaceholder'),
    subtitle: (
      <>
        {overview ? t('apiRoutes.filteredCount', { shown: filteredRoutes.length, total: overview.routes.length }) : t('apiRoutes.subtitle')}
        {' '}
        <ArchMetricsText items={metrics} />
      </>
    ),
    content,
  };
}
