import React, { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { useNavigate } from 'react-router-dom';
import type { FolderRow, LaravelSchemaGraph, LaravelSchemaRelation } from '../../shared/api';
import EChartsPanel from '../components/EChartsPanel';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import { useI18n } from '../i18n';

interface Props {
  folder: FolderRow | null;
  scanRevision: number;
}

const CHART_TEXT = '#e6edf3';
const CHART_MUTED = '#8b949e';
const CHART_BORDER = '#2a313c';
const CHART_TOOLTIP_BACKGROUND = '#161b22';

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

export default function LaravelSchemaView({ folder, scanRevision }: Props) {
  const [schema, setSchema] = useState<LaravelSchemaGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedRelationKinds, setSelectedRelationKinds] = useState<Set<OrmRelationKind>>(() => new Set(DEFAULT_RELATION_KINDS));
  const [selectedRelationKey, setSelectedRelationKey] = useState<string | null>(null);
  const navigate = useNavigate();
  const { locale, t } = useI18n();

  useEffect(() => {
    let ignore = false;

    if (!folder) {
      setSchema(null);
      setLoading(false);
      return () => { ignore = true; };
    }

    setLoading(true);
    void window.api.stats.laravelSchema(folder.id).then(nextSchema => {
      if (ignore) return;
      setSchema(nextSchema);
      setLoading(false);
    }).catch(() => {
      if (ignore) return;
      setSchema(emptySchema());
      setLoading(false);
    });

    return () => { ignore = true; };
  }, [folder?.id, scanRevision]);

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

  const analysisSteps = useMemo(
    () => [
      t('laravelSchema.stepScanModels'),
      t('laravelSchema.stepParseModels'),
      t('laravelSchema.stepReadRelations'),
      t('laravelSchema.stepInferKeys'),
      t('laravelSchema.stepGenerateDiagram'),
    ],
    [t],
  );

  const chartOption = useMemo<EChartsOption>(() => ({
    animationDuration: 700,
    legend: {
      bottom: 0,
      left: 0,
      textStyle: { color: CHART_TEXT },
      data: [t('laravelSchema.tables'), t('laravelSchema.modelBacked')],
    },
    tooltip: {
      backgroundColor: CHART_TOOLTIP_BACKGROUND,
      borderColor: CHART_BORDER,
      textStyle: { color: CHART_TEXT },
      formatter: params => {
        if (params.dataType === 'edge') {
          const data = params.data as { kind: string; label?: string };
          return data.label ?? data.kind;
        }

        const data = params.data as { name: string; tableName: string; modelClass: string | null; relations: number };
        return [
          data.name,
          `${t('laravelSchema.relations')}: ${data.relations.toLocaleString(locale)}`,
          data.modelClass ? `${t('laravelSchema.model')}: ${data.modelClass}` : '',
          !data.modelClass ? `${t('laravelSchema.table')}: ${data.tableName}` : '',
        ].filter(Boolean).join('<br/>');
      },
    },
    series: [
      {
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
          color: CHART_MUTED,
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
            label: { show: true, color: CHART_TEXT, overflow: 'truncate', width: 120 },
            itemStyle: table.modelPath ? { borderColor: '#7cc7a0', borderWidth: 2 } : undefined,
          };
        }),
        links: filteredRelations.map(relation => ({
          source: relation.sourceTable,
          target: relation.targetTable,
          kind: relation.kind,
          label: relation.label,
          relationKey: relationKey(relation),
          lineStyle: relationLineStyle(relation.kind),
        })),
      },
    ],
  }), [filteredRelations, locale, relationCounts, t, visibleTables]);

  function resetRelationFilters() {
    setSelectedRelationKinds(new Set(DEFAULT_RELATION_KINDS));
  }

  function toggleRelationKind(kind: OrmRelationKind) {
    setSelectedRelationKinds(current => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  if (!folder) return <div className="empty">{t('common.selectFolder')}</div>;

  return (
    <div className="laravel-schema-page">
      <PageHeader
        title={t('laravelSchema.title')}
        description={t('laravelSchema.subtitle')}
      />

      <div className="chart-grid laravel-schema-guide-grid">
        <div className="chart-box laravel-schema-guide-box">
          <div>
            <h3>{t('laravelSchema.supportedTitle')}</h3>
            <p className="laravel-schema-guide-copy">{t('laravelSchema.supportedSubtitle')}</p>
          </div>
          <ul className="laravel-schema-method-list">
            {SUPPORTED_RELATION_METHODS.map(({ kind, method }) => {
              const count = relationKindCounts.get(kind) ?? 0;
              return (
                <li key={kind}>
                  <span className="laravel-schema-method-name">{method}</span>
                  <span className="laravel-schema-method-count">{count.toLocaleString(locale)}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="chart-box laravel-schema-guide-box">
          <div>
            <h3>{t('laravelSchema.pipelineTitle')}</h3>
            <p className="laravel-schema-guide-copy">{t('laravelSchema.pipelineSubtitle')}</p>
          </div>
          <ol className="laravel-schema-step-list">
            {analysisSteps.map(step => <li key={step}>{step}</li>)}
          </ol>
        </div>
      </div>

      {loading ? <EmptyState description={t('laravelSchema.loading')} /> : null}
      {!loading && schema && !schema.isLaravel ? <EmptyState description={t('laravelSchema.notLaravel')} /> : null}
      {!loading && schema?.isLaravel && schema.tables.length === 0 ? <EmptyState description={t('laravelSchema.noTables')} /> : null}

      {!loading && schema?.isLaravel && visibleTables.length > 0 ? (
        <>
          <div className="cards laravel-schema-cards">
            <div className="card metric-card"><div className="label">{t('laravelSchema.tables')}</div><div className="value">{schema.tables.length.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('laravelSchema.relations')}</div><div className="value">{ormRelations.length.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('laravelSchema.migrations')}</div><div className="value">{schema.migrationCount.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('laravelSchema.models')}</div><div className="value">{schema.modelCount.toLocaleString(locale)}</div></div>
          </div>

          <div className="laravel-schema-filter-bar">
            <div>
              <strong>{t('laravelSchema.filterTitle')}</strong>
              <div className="laravel-schema-filter-summary">
                {t('laravelSchema.filteredRelations', { shown: filteredRelations.length, total: ormRelations.length })}
              </div>
            </div>
            <div className="laravel-schema-filter-actions" aria-label={t('laravelSchema.filterTitle')}>
              <button
                type="button"
                className={allFiltersSelected ? 'api-routes-depth-button active' : 'api-routes-depth-button'}
                onClick={resetRelationFilters}
              >
                {t('laravelSchema.filterAll')}
              </button>
              {relationFilterMethods.map(({ kind, method }) => (
                <button
                  key={kind}
                  type="button"
                  className={selectedRelationKinds.has(kind) ? 'api-routes-depth-button active' : 'api-routes-depth-button'}
                  onClick={() => toggleRelationKind(kind)}
                >
                  {method.replace(/\(\)$/, '')}
                </button>
              ))}
            </div>
          </div>

          <div className="chart-box laravel-schema-chart-box">
            <EChartsPanel
              option={chartOption}
              onEvents={{
                click: params => {
                  if (typeof params === 'object' && params && 'dataType' in params && params.dataType === 'edge') {
                    const nextRelationKey = typeof params.data === 'object' && params.data && 'relationKey' in params.data
                      ? String(params.data.relationKey)
                      : null;
                    if (nextRelationKey) setSelectedRelationKey(nextRelationKey);
                    return;
                  }

                  const tableName = typeof params === 'object' && params && 'dataType' in params && params.dataType === 'node'
                    && typeof params.data === 'object' && params.data && 'id' in params.data
                    ? String(params.data.id)
                    : null;
                  const table = tableName ? schema.tables.find(item => item.name === tableName) : null;
                  const target = table?.modelPath ?? null;
                  if (target) navigate(`/editor/${encodeURIComponent(target)}`);
                },
              }}
            />
          </div>

          <div className="relations-chart-meta">
            <span>{t('laravelSchema.detectedBy', { value: schema.detectedBy.join(', ') })}</span>
            <span>{t('laravelSchema.edgeHint')}</span>
            {schema.unresolvedModelRelations > 0 ? <span>{t('laravelSchema.unresolved', { count: schema.unresolvedModelRelations })}</span> : null}
          </div>

          {selectedRelation ? (
            <div className="side-drawer-backdrop" onClick={() => setSelectedRelationKey(null)}>
              <aside className="side-drawer laravel-schema-relation-drawer" role="dialog" aria-modal="true" aria-label={t('laravelSchema.relationDetails')} onClick={event => event.stopPropagation()}>
                <div className="side-drawer-header">
                  <div>
                    <div className="label">{selectedRelation.kind}</div>
                    <strong>{selectedRelation.sourceTable} -&gt; {selectedRelation.targetTable}</strong>
                  </div>
                  <button type="button" onClick={() => setSelectedRelationKey(null)}>{t('common.close')}</button>
                </div>
                <div className="laravel-schema-relation-label">{selectedRelation.label}</div>
                <dl className="laravel-schema-relation-details">
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
                {selectedRelation.sourceFile ? (
                  <button type="button" onClick={() => navigate(`/editor/${encodeURIComponent(selectedRelation.sourceFile ?? '')}`)}>
                    {t('laravelSchema.openSource')}
                  </button>
                ) : null}
              </aside>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}