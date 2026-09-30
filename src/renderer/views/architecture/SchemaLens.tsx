import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { useNavigate } from 'react-router-dom';
import type { LaravelSchemaGraph, LaravelSchemaRelation } from '../../../shared/api';
import {
  Button,
  Chart,
  Checkbox,
  Drawer,
  EmptyState,
  Panel,
  Spinner,
  type ChartTokens,
} from '../../components/ui';
import ScanNowButton from '../../components/ScanNowButton';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { useI18n } from '../../i18n';
import { firstFormatterParam } from '../../utils/echartsParams';
import { escapeHtml } from '../../utils/escapeHtml';
import { useActiveIsLaravel, useRevision } from '../../store/app-store';
import {
  ArchMetrics,
  useGraphMenu,
  type ArchLens,
  type ArchLensArgs,
  type ArchMetric,
  type ChartEvents,
} from './lens';

type OrmRelationKind = Exclude<LaravelSchemaRelation['kind'], 'foreign-key'>;
type OrmLaravelRelation = LaravelSchemaRelation & { kind: OrmRelationKind };

const SUPPORTED_RELATION_METHODS: Array<{ kind: OrmRelationKind; method: string }> = [
  { kind: 'belongsTo', method: 'belongsTo()' },
  { kind: 'hasOne', method: 'hasOne()' },
  { kind: 'hasMany', method: 'hasMany()' },
  { kind: 'belongsToMany', method: 'belongsToMany()' },
  { kind: 'morphOne', method: 'morphOne()' },
  { kind: 'morphMany', method: 'morphMany()' },
  { kind: 'morphTo', method: 'morphTo()' },
  { kind: 'morphToMany', method: 'morphToMany()' },
];
const EXTRA_RELATION_METHODS: Array<{ kind: OrmRelationKind; method: string }> = [
  { kind: 'morphedByMany', method: 'morphedByMany()' },
];
const DEFAULT_RELATION_KINDS = [...SUPPORTED_RELATION_METHODS, ...EXTRA_RELATION_METHODS].map(item => item.kind);

function emptySchema(): LaravelSchemaGraph {
  return { isLaravel: false, detectedBy: [], tables: [], relations: [], migrationCount: 0, modelCount: 0, unresolvedModelRelations: 0, warnings: [] };
}

function nodeName(modelClass: string | null, tableName: string): string {
  return modelClass?.split('\\').filter(Boolean).pop() ?? tableName;
}

function relationLineStyle(kind: string) {
  if (kind.startsWith('morph')) return { width: 2, type: 'dashed' as const, opacity: 0.64 };
  if (kind.endsWith('Many')) return { width: 2, type: 'dotted' as const, opacity: 0.58 };
  return { width: 1.8, type: 'solid' as const, opacity: 0.58 };
}

function relationKey(relation: LaravelSchemaRelation): string {
  return [
    relation.sourceTable,
    relation.targetTable,
    relation.kind,
    relation.sourceColumn ?? '',
    relation.targetColumn ?? '',
    relation.sourceModel ?? '',
    relation.targetModel ?? '',
    relation.sourceFile ?? '',
  ].join('|');
}

function optionalValue(value: string | null): string {
  return value && value.trim() ? value : '-';
}

/**
 * The Schema lens (was `/laravel-schema`). It no longer vanishes from the nav
 * and no longer force-redirects you off itself when detection flips
 * (`App.tsx:389-397`): the lens is always listed, and selecting it without a
 * Laravel project shows the reason instead of nothing.
 *
 * The relation-kind filter stays multi-select — the blueprint's `ToggleGroup`
 * is single-select and would have cost the ability to show two kinds at once —
 * but it moves off the page body into the toolbar's filters row.
 */
export function useSchemaLens({ folder, active }: ArchLensArgs): ArchLens {
  const revision = useRevision();
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const detectedLaravel = useActiveIsLaravel();

  const [selectedRelationKinds, setSelectedRelationKinds] = useState<Set<OrmRelationKind>>(() => new Set(DEFAULT_RELATION_KINDS));
  const [selectedRelationKey, setSelectedRelationKey] = useState<string | null>(null);

  const folderId = folder.id;
  const loadSchema = useCallback(() => window.api.stats.laravelSchema(folderId), [folderId]);
  const schemaErrorData = useCallback(() => emptySchema(), []);
  const { data: schema, loading } = useAsyncResource<LaravelSchemaGraph | null>({
    resourceKey: folderId,
    refreshToken: revision,
    enabled: active,
    initialData: null,
    load: loadSchema,
    errorData: schemaErrorData,
  });

  useEffect(() => {
    setSelectedRelationKey(null);
  }, [folderId]);

  const ormRelations = useMemo<OrmLaravelRelation[]>(
    () => (schema?.relations ?? []).filter((relation): relation is OrmLaravelRelation => relation.kind !== 'foreign-key'),
    [schema],
  );

  const filteredRelations = useMemo(
    () => ormRelations.filter(relation => selectedRelationKinds.has(relation.kind)),
    [ormRelations, selectedRelationKinds],
  );

  const selectedRelation = useMemo(
    () => (selectedRelationKey ? filteredRelations.find(relation => relationKey(relation) === selectedRelationKey) ?? null : null),
    [filteredRelations, selectedRelationKey],
  );

  useEffect(() => {
    if (selectedRelationKey && !selectedRelation) setSelectedRelationKey(null);
  }, [selectedRelation, selectedRelationKey]);

  const relationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const relation of filteredRelations) {
      counts.set(relation.sourceTable, (counts.get(relation.sourceTable) ?? 0) + 1);
      counts.set(relation.targetTable, (counts.get(relation.targetTable) ?? 0) + 1);
    }
    return counts;
  }, [filteredRelations]);

  const relationKindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const relation of ormRelations) {
      counts.set(relation.kind, (counts.get(relation.kind) ?? 0) + 1);
    }
    return counts;
  }, [ormRelations]);

  const relationFilterMethods = useMemo(() => {
    const methods = [...SUPPORTED_RELATION_METHODS];
    for (const method of EXTRA_RELATION_METHODS) {
      if (relationKindCounts.has(method.kind)) methods.push(method);
    }
    return methods;
  }, [relationKindCounts]);

  const allFiltersSelected = DEFAULT_RELATION_KINDS.every(kind => selectedRelationKinds.has(kind));

  const visibleTables = useMemo(
    () => (schema?.tables ?? []).filter(table => relationCounts.has(table.name) || (allFiltersSelected && table.modelPath)),
    [allFiltersSelected, relationCounts, schema],
  );

  const resetRelationFilters = useCallback(() => {
    setSelectedRelationKinds(new Set(DEFAULT_RELATION_KINDS));
  }, []);

  function toggleRelationKind(kind: OrmRelationKind): void {
    setSelectedRelationKinds(current => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  const chartEvents = useMemo<ChartEvents>(() => ({
    click: params => {
      if (typeof params === 'object' && params && 'dataType' in params && params.dataType === 'edge') {
        const nextRelationKey = 'data' in params && typeof params.data === 'object' && params.data && 'relationKey' in params.data
          ? String(params.data.relationKey)
          : null;
        if (nextRelationKey) setSelectedRelationKey(nextRelationKey);
        return;
      }

      const tableName = typeof params === 'object' && params && 'dataType' in params && params.dataType === 'node'
        && 'data' in params && typeof params.data === 'object' && params.data && 'id' in params.data
        ? String(params.data.id)
        : null;
      const table = tableName ? schema?.tables.find(item => item.name === tableName) : null;
      const target = table?.modelPath ?? null;
      if (target) navigate(`/editor/${encodeURIComponent(target)}`);
    },
  }), [navigate, schema]);

  const menu = useGraphMenu({
    graph: true,
    fileName: 'schema',
    data: useCallback(() => ({ tables: visibleTables, relations: filteredRelations }), [filteredRelations, visibleTables]),
    onReset: resetRelationFilters,
    resetDisabled: allFiltersSelected,
    chartEvents,
  });

  const seed = menu.seed;

  const chartOption = useCallback((tokens: ChartTokens): EChartsOption => ({
    animationDuration: 700,
    // Two categories on an all-pairs form -> categorical slots 1 and 2 only
    // (DESIGN-SYSTEM §1.6), in order, never cycled.
    color: tokens.categorical.slice(0, 2),
    legend: {
      bottom: 0,
      left: 0,
      textStyle: { color: tokens.ink },
      data: [t('laravelSchema.tables'), t('laravelSchema.modelBacked')],
    },
    tooltip: {
      backgroundColor: tokens.tooltipBg,
      borderColor: tokens.tooltipBorder,
      textStyle: { color: tokens.ink },
      formatter: params => {
        const param = firstFormatterParam(params);
        if (!param) return '';
        if (param.dataType === 'edge') {
          const data = param.data as { kind: string; relationLabel?: string };
          return escapeHtml(data.relationLabel ?? data.kind);
        }

        const data = param.data as { name: string; tableName: string; modelClass: string | null; relations: number };
        return [
          escapeHtml(data.name),
          `${t('laravelSchema.relations')}: ${data.relations.toLocaleString(locale)}`,
          data.modelClass ? `${t('laravelSchema.model')}: ${escapeHtml(data.modelClass)}` : '',
          !data.modelClass ? `${t('laravelSchema.table')}: ${escapeHtml(data.tableName)}` : '',
        ].filter(Boolean).join('<br/>');
      },
    },
    series: [
      {
        id: `schema-graph-${seed}`,
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        emphasis: { focus: 'adjacency' },
        categories: [
          { name: t('laravelSchema.tables') },
          { name: t('laravelSchema.modelBacked') },
        ],
        force: {
          repulsion: 280,
          gravity: 0.06,
          edgeLength: [70, 160],
          friction: 0.2,
        },
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: [0, 10],
        lineStyle: {
          color: 'source',
          opacity: 0.5,
          curveness: 0.12,
        },
        edgeLabel: {
          show: true,
          color: tokens.inkMuted,
          fontSize: 10,
          formatter: ({ data }) => (data as { kind?: string }).kind ?? '',
        },
        data: visibleTables.map(table => {
          const relations = relationCounts.get(table.name) ?? 0;
          return {
            id: table.name,
            name: nodeName(table.modelClass, table.name),
            tableName: table.name,
            modelClass: table.modelClass,
            relations,
            category: table.modelPath ? 1 : 0,
            symbolSize: 24 + Math.min(26, Math.sqrt(Math.max(relations, 1) * 28)),
            label: { show: true, color: tokens.ink, overflow: 'truncate', width: 120 },
            // Reinforces the "Model-backed tables" legend category; the ring is
            // the shared --ds-chart-mark-ring, never a hardcoded green.
            itemStyle: table.modelPath ? { borderColor: tokens.markRing, borderWidth: 2 } : undefined,
          };
        }),
        links: filteredRelations.map(relation => ({
          source: relation.sourceTable,
          target: relation.targetTable,
          kind: relation.kind,
          // Tooltip payload only; named to avoid clashing with the ECharts `label` option.
          relationLabel: relation.label,
          relationKey: relationKey(relation),
          lineStyle: relationLineStyle(relation.kind),
        })),
      },
    ],
  }), [filteredRelations, locale, relationCounts, seed, t, visibleTables]);

  const metrics: ArchMetric[] = schema?.isLaravel
    ? [
      { label: t('laravelSchema.tables'), value: schema.tables.length.toLocaleString(locale) },
      { label: t('laravelSchema.relations'), value: ormRelations.length.toLocaleString(locale) },
      { label: t('laravelSchema.migrations'), value: schema.migrationCount.toLocaleString(locale) },
      { label: t('laravelSchema.models'), value: schema.modelCount.toLocaleString(locale) },
    ]
    : [];

  const available = schema ? schema.isLaravel : detectedLaravel !== false;

  const filters = available ? (
    <>
      <span className="text-xs text-fg-muted">{t('laravelSchema.filterTitle')}</span>
      <Button size="sm" disabled={allFiltersSelected} onClick={resetRelationFilters}>
        {t('laravelSchema.filterAll')}
      </Button>
      <div
        role="group"
        aria-label={t('laravelSchema.filterTitle')}
        className="flex flex-wrap items-center gap-x-3 gap-y-1"
      >
        {relationFilterMethods.map(({ kind, method }) => (
          <Checkbox
            key={kind}
            size="sm"
            checked={selectedRelationKinds.has(kind)}
            onChange={() => toggleRelationKind(kind)}
            label={method.replace(/\(\)$/, '')}
          />
        ))}
      </div>
    </>
  ) : undefined;

  const content = (
    <div className="grid gap-4">
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-10">
          <Spinner size="md" label={t('laravelSchema.loading')} />
        </div>
      ) : null}

      {!loading && schema && !schema.isLaravel ? (
        <EmptyState
          variant="no-results"
          title={t('nav.laravelRequired')}
          description={t('laravelSchema.notLaravel')}
          action={<ScanNowButton folderId={folderId} disabled={!folder.isAvailable} />}
          secondaryAction={(
            <Button onClick={() => navigate('/')}>{t('nav.workspace')}</Button>
          )}
        />
      ) : null}

      {!loading && schema?.isLaravel && schema.tables.length === 0 ? (
        <EmptyState
          title={t('common.noData')}
          description={t('laravelSchema.noTables')}
          action={<ScanNowButton folderId={folderId} disabled={!folder.isAvailable} />}
        />
      ) : null}

      {!loading && schema?.isLaravel && visibleTables.length > 0 ? (
        <>
          <ArchMetrics items={metrics} />

          <Panel className="overflow-hidden">
            <Chart
              option={chartOption}
              ariaLabel={t('laravelSchema.title')}
              height={536}
              onEvents={menu.onEvents}
            />
          </Panel>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-fg-muted">
            <span>{t('laravelSchema.detectedBy', { value: schema.detectedBy.join(', ') })}</span>
            <span>{t('laravelSchema.edgeHint')}</span>
            {schema.unresolvedModelRelations > 0
              ? <span>{t('laravelSchema.unresolved', { count: schema.unresolvedModelRelations })}</span>
              : null}
          </div>

          {selectedRelation ? (
            <Drawer
              open
              onOpenChange={next => {
                if (!next) setSelectedRelationKey(null);
              }}
              side="right"
              size="sm"
              closeLabel={t('common.close')}
              title={`${selectedRelation.sourceTable} → ${selectedRelation.targetTable}`}
              description={selectedRelation.kind}
              footer={selectedRelation.sourceFile ? (
                <Button
                  variant="primary"
                  onClick={() => navigate(`/editor/${encodeURIComponent(selectedRelation.sourceFile ?? '')}`)}
                >
                  {t('laravelSchema.openSource')}
                </Button>
              ) : undefined}
            >
              <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-fg [overflow-wrap:anywhere]">{selectedRelation.label}</div>
              {/* The old `.laravel-schema-relation-details` descendant rules become
                  one arbitrary variant each, so the seven term/value pairs below
                  stay plain markup. */}
              <dl
                className={
                  'm-0 grid gap-2.5 ' +
                  '[&>div]:grid [&>div]:gap-1 [&>div]:border-b [&>div]:border-border [&>div]:pb-2.5 ' +
                  '[&_dt]:text-xs [&_dt]:uppercase [&_dt]:text-fg-muted ' +
                  '[&_dd]:m-0 [&_dd]:font-mono [&_dd]:[overflow-wrap:anywhere]'
                }
              >
                <div>
                  <dt>{t('laravelSchema.sourceTable')}</dt>
                  <dd>{selectedRelation.sourceTable}</dd>
                </div>
                <div>
                  <dt>{t('laravelSchema.targetTable')}</dt>
                  <dd>{selectedRelation.targetTable}</dd>
                </div>
                <div>
                  <dt>{t('laravelSchema.sourceColumn')}</dt>
                  <dd>{optionalValue(selectedRelation.sourceColumn)}</dd>
                </div>
                <div>
                  <dt>{t('laravelSchema.targetColumn')}</dt>
                  <dd>{optionalValue(selectedRelation.targetColumn)}</dd>
                </div>
                <div>
                  <dt>{t('laravelSchema.sourceModel')}</dt>
                  <dd>{optionalValue(selectedRelation.sourceModel)}</dd>
                </div>
                <div>
                  <dt>{t('laravelSchema.targetModel')}</dt>
                  <dd>{optionalValue(selectedRelation.targetModel)}</dd>
                </div>
                <div>
                  <dt>{t('laravelSchema.sourceFile')}</dt>
                  <dd>{optionalValue(selectedRelation.sourceFile)}</dd>
                </div>
              </dl>
            </Drawer>
          ) : null}
        </>
      ) : null}
    </div>
  );

  return {
    count: schema?.isLaravel ? schema.tables.length : undefined,
    available,
    filters,
    overflow: available ? menu.items : undefined,
    subtitle: schema?.isLaravel
      ? t('laravelSchema.filteredRelations', { shown: filteredRelations.length, total: ormRelations.length })
      : t('laravelSchema.subtitle'),
    content,
  };
}
