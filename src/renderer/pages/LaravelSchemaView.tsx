import React, { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { useNavigate } from 'react-router-dom';
import type { FolderRow, LaravelSchemaGraph, LaravelSchemaTable } from '../../shared/api';
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

function emptySchema(): LaravelSchemaGraph {
  return { isLaravel: false, detectedBy: [], tables: [], relations: [], migrationCount: 0, modelCount: 0, unresolvedModelRelations: 0, warnings: [] };
}

function tableScore(table: LaravelSchemaTable, relationCount: number): number {
  return table.columns.length + (relationCount * 2) + (table.modelPath ? 4 : 0);
}

export default function LaravelSchemaView({ folder, scanRevision }: Props) {
  const [schema, setSchema] = useState<LaravelSchemaGraph | null>(null);
  const [loading, setLoading] = useState(false);
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

  const relationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const relation of schema?.relations ?? []) {
      counts.set(relation.sourceTable, (counts.get(relation.sourceTable) ?? 0) + 1);
      counts.set(relation.targetTable, (counts.get(relation.targetTable) ?? 0) + 1);
    }
    return counts;
  }, [schema]);

  const topTables = useMemo(
    () => [...(schema?.tables ?? [])].sort((left, right) => tableScore(right, relationCounts.get(right.name) ?? 0) - tableScore(left, relationCounts.get(left.name) ?? 0)).slice(0, 40),
    [relationCounts, schema],
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
          const data = params.data as { source: string; target: string; label: string; kind: string };
          return [data.label, `${data.source} -> ${data.target}`, data.kind].join('<br/>');
        }

        const data = params.data as { table: LaravelSchemaTable; relations: number };
        const columns = data.table.columns.slice(0, 10).map(column => `${column.name}: ${column.type}`);
        return [
          data.table.name,
          `${t('laravelSchema.columns')}: ${data.table.columns.length.toLocaleString(locale)}`,
          `${t('laravelSchema.relations')}: ${data.relations.toLocaleString(locale)}`,
          data.table.modelClass ? `${t('laravelSchema.model')}: ${data.table.modelClass}` : '',
          ...columns,
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
          formatter: ({ data }) => (data as { label?: string }).label ?? '',
        },
        data: (schema?.tables ?? []).map(table => {
          const relations = relationCounts.get(table.name) ?? 0;
          return {
            id: table.name,
            name: table.name,
            table,
            relations,
            category: table.modelPath ? 1 : 0,
            symbolSize: 22 + Math.min(34, Math.sqrt((table.columns.length * 8) + (relations * 24))),
            label: { show: true, color: CHART_TEXT, overflow: 'truncate', width: 120 },
            itemStyle: table.modelPath ? { borderColor: '#7cc7a0', borderWidth: 2 } : undefined,
          };
        }),
        links: (schema?.relations ?? []).map(relation => ({
          source: relation.sourceTable,
          target: relation.targetTable,
          kind: relation.kind,
          label: relation.label,
          lineStyle: {
            width: relation.kind === 'foreign-key' ? 2.2 : 1.4,
            type: relation.kind === 'foreign-key' ? 'solid' : 'dashed',
            opacity: relation.kind === 'foreign-key' ? 0.68 : 0.42,
          },
        })),
      },
    ],
  }), [locale, relationCounts, schema, t]);

  if (!folder) return <div className="empty">{t('common.selectFolder')}</div>;

  return (
    <div className="laravel-schema-page">
      <PageHeader
        title={t('laravelSchema.title')}
        description={t('laravelSchema.subtitle')}
      />

      {loading ? <EmptyState description={t('laravelSchema.loading')} /> : null}
      {!loading && schema && !schema.isLaravel ? <EmptyState description={t('laravelSchema.notLaravel')} /> : null}
      {!loading && schema?.isLaravel && schema.tables.length === 0 ? <EmptyState description={t('laravelSchema.noTables')} /> : null}

      {!loading && schema?.isLaravel && schema.tables.length > 0 ? (
        <>
          <div className="cards laravel-schema-cards">
            <div className="card metric-card"><div className="label">{t('laravelSchema.tables')}</div><div className="value">{schema.tables.length.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('laravelSchema.relations')}</div><div className="value">{schema.relations.length.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('laravelSchema.migrations')}</div><div className="value">{schema.migrationCount.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('laravelSchema.models')}</div><div className="value">{schema.modelCount.toLocaleString(locale)}</div></div>
          </div>

          <div className="chart-box laravel-schema-chart-box">
            <EChartsPanel
              option={chartOption}
              onEvents={{
                click: params => {
                  const table = typeof params === 'object' && params && 'dataType' in params && params.dataType === 'node'
                    && typeof params.data === 'object' && params.data && 'table' in params.data
                    ? params.data.table as LaravelSchemaTable
                    : null;
                  const target = table?.modelPath ?? table?.migrationFiles[0] ?? null;
                  if (target) navigate(`/editor/${encodeURIComponent(target)}`);
                },
              }}
            />
          </div>

          <div className="relations-chart-meta">
            <span>{t('laravelSchema.detectedBy', { value: schema.detectedBy.join(', ') })}</span>
            {schema.unresolvedModelRelations > 0 ? <span>{t('laravelSchema.unresolved', { count: schema.unresolvedModelRelations })}</span> : null}
          </div>

          <h2 className="section-heading">{t('laravelSchema.tableDetails')}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('laravelSchema.table')}</th>
                  <th>{t('laravelSchema.columns')}</th>
                  <th>{t('laravelSchema.model')}</th>
                  <th>{t('laravelSchema.migrations')}</th>
                  <th>{t('laravelSchema.relations')}</th>
                </tr>
              </thead>
              <tbody>
                {topTables.map(table => (
                  <tr key={table.name} className="clickable-row" onClick={() => {
                    const target = table.modelPath ?? table.migrationFiles[0];
                    if (target) navigate(`/editor/${encodeURIComponent(target)}`);
                  }}>
                    <td className="mono">{table.name}</td>
                    <td className="mono laravel-schema-column-list">{table.columns.map(column => `${column.name}:${column.type}`).join(', ')}</td>
                    <td className="mono">{table.modelClass ?? '-'}</td>
                    <td>{table.migrationFiles.length.toLocaleString(locale)}</td>
                    <td>{(relationCounts.get(table.name) ?? 0).toLocaleString(locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}