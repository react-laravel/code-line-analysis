import React, { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { useNavigate } from 'react-router-dom';
import type { FileRelationGraph, FileRelationNode, FolderRow } from '../../shared/api';
import EChartsPanel from '../components/EChartsPanel';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import { useI18n } from '../i18n';

interface Props {
  folder: FolderRow | null;
  scanRevision: number;
}

const MAX_VISIBLE_NODES = 80;
const MAX_TABLE_ROWS = 30;
const CHART_TEXT = '#e6edf3';
const CHART_MUTED = '#8b949e';
const CHART_BORDER = '#2a313c';
const CHART_TOOLTIP_BACKGROUND = '#161b22';

function basename(relPath: string): string {
  const parts = relPath.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? relPath;
}

function nodeScore(node: FileRelationNode): number {
  return (node.incoming * 2) + node.outgoing + Math.min(12, Math.round(node.code / 120));
}

function getVisibleGraph(graph: FileRelationGraph) {
  const rankedNodes = [...graph.nodes].sort((left, right) => nodeScore(right) - nodeScore(left) || right.code - left.code || left.relPath.localeCompare(right.relPath));
  const visibleIds = new Set(rankedNodes.slice(0, MAX_VISIBLE_NODES).map(node => node.id));

  return {
    nodes: graph.nodes.filter(node => visibleIds.has(node.id)),
    edges: graph.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
  };
}

export default function RelationsView({ folder, scanRevision }: Props) {
  const [graph, setGraph] = useState<FileRelationGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { locale, t } = useI18n();

  useEffect(() => {
    let ignore = false;

    if (!folder) {
      setGraph(null);
      setLoading(false);
      return () => { ignore = true; };
    }

    setLoading(true);
    void window.api.stats.fileRelations(folder.id).then(nextGraph => {
      if (ignore) return;
      setGraph(nextGraph);
      setLoading(false);
    }).catch(() => {
      if (ignore) return;
      setGraph({ nodes: [], edges: [], scannedFiles: 0, connectedFiles: 0, unresolvedCount: 0 });
      setLoading(false);
    });

    return () => { ignore = true; };
  }, [folder?.id, scanRevision]);

  const visibleGraph = useMemo(() => (graph ? getVisibleGraph(graph) : { nodes: [], edges: [] }), [graph]);
  const topConnectedFiles = useMemo(
    () => [...(graph?.nodes ?? [])].sort((left, right) => nodeScore(right) - nodeScore(left) || right.code - left.code).slice(0, MAX_TABLE_ROWS),
    [graph],
  );

  const chartOption = useMemo<EChartsOption>(() => {
    const groupCounts = new Map<string, number>();
    visibleGraph.nodes.forEach(node => groupCounts.set(node.group, (groupCounts.get(node.group) ?? 0) + 1));
    const orderedGroups = Array.from(groupCounts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([group]) => group);
    const groupIndex = new Map(orderedGroups.map((group, index) => [group, index]));
    const prominentIds = new Set(
      [...visibleGraph.nodes]
        .sort((left, right) => nodeScore(right) - nodeScore(left) || right.code - left.code)
        .slice(0, 14)
        .map(node => node.id),
    );

    return {
      animationDuration: 700,
      legend: orderedGroups.length > 0 && orderedGroups.length <= 8 ? {
        bottom: 0,
        left: 0,
        textStyle: { color: CHART_TEXT },
        data: orderedGroups,
      } : undefined,
      tooltip: {
        backgroundColor: CHART_TOOLTIP_BACKGROUND,
        borderColor: CHART_BORDER,
        textStyle: { color: CHART_TEXT },
        formatter: params => {
          if (params.dataType === 'edge') {
            return `${params.data.source}<br/>→ ${params.data.target}`;
          }

          const data = params.data as {
            relPath: string;
            lang: string;
            code: number;
            incoming: number;
            outgoing: number;
          };
          return [
            data.relPath,
            `${t('common.language')}: ${data.lang}`,
            `${t('common.code')}: ${Number(data.code).toLocaleString(locale)}`,
            `${t('relations.incoming')}: ${Number(data.incoming).toLocaleString(locale)}`,
            `${t('relations.outgoing')}: ${Number(data.outgoing).toLocaleString(locale)}`,
          ].join('<br/>');
        },
      },
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          emphasis: { focus: 'adjacency' },
          force: {
            repulsion: 230,
            gravity: 0.05,
            edgeLength: [36, 120],
            friction: 0.18,
          },
          lineStyle: {
            color: 'source',
            curveness: 0.16,
            opacity: 0.42,
            width: 1.2,
          },
          categories: orderedGroups.map(group => ({ name: group })),
          data: visibleGraph.nodes.map(node => ({
            id: node.id,
            name: basename(node.relPath),
            relPath: node.relPath,
            lang: node.lang,
            code: node.code,
            incoming: node.incoming,
            outgoing: node.outgoing,
            category: groupIndex.get(node.group) ?? 0,
            symbolSize: 14 + Math.min(30, Math.sqrt((node.incoming + node.outgoing) * 18 + Math.max(node.code, 1) / 18)),
            itemStyle: node.isTest ? { borderColor: '#e2b86b', borderWidth: 2 } : undefined,
            label: prominentIds.has(node.id)
              ? { show: true, color: CHART_TEXT, formatter: basename(node.relPath), overflow: 'truncate', width: 120 }
              : { show: false },
          })),
          links: visibleGraph.edges.map(edge => ({
            source: edge.source,
            target: edge.target,
            value: edge.value,
            lineStyle: { width: 1 + Math.min(2.8, edge.value * 0.8), opacity: 0.42, curveness: 0.16 },
          })),
        },
      ],
      textStyle: { color: CHART_MUTED },
    };
  }, [locale, t, visibleGraph]);

  if (!folder) return <div className="empty">{t('common.selectFolder')}</div>;

  return (
    <div className="relations-page">
      <PageHeader
        title={t('relations.title')}
        description={t('relations.subtitle')}
      />

      {loading ? <EmptyState description={t('relations.loading')} /> : null}
      {!loading && graph && graph.connectedFiles === 0 ? <EmptyState description={t('relations.noData')} /> : null}

      {!loading && graph && graph.connectedFiles > 0 ? (
        <>
          <div className="cards relations-cards">
            <div className="card metric-card">
              <div className="label">{t('relations.scannedFiles')}</div>
              <div className="value">{graph.scannedFiles.toLocaleString(locale)}</div>
            </div>
            <div className="card metric-card">
              <div className="label">{t('relations.connectedFiles')}</div>
              <div className="value">{graph.connectedFiles.toLocaleString(locale)}</div>
            </div>
            <div className="card metric-card">
              <div className="label">{t('relations.links')}</div>
              <div className="value">{graph.edges.length.toLocaleString(locale)}</div>
            </div>
            <div className="card metric-card">
              <div className="label">{t('relations.unresolved')}</div>
              <div className="value">{graph.unresolvedCount.toLocaleString(locale)}</div>
            </div>
          </div>

          <div className="chart-box relations-chart-box">
            <EChartsPanel
              option={chartOption}
              onEvents={{
                click: params => {
                  const relPath = typeof params === 'object' && params && 'dataType' in params && params.dataType === 'node'
                    && typeof params.data === 'object' && params.data && 'relPath' in params.data
                    ? String(params.data.relPath)
                    : null;
                  if (relPath) navigate(`/editor/${encodeURIComponent(relPath)}`);
                },
              }}
            />
          </div>

          <div className="relations-chart-meta">
            <span>{t('relations.visibleGraph', { visible: visibleGraph.nodes.length, total: graph.connectedFiles })}</span>
            <span>{t('relations.clickHint')}</span>
          </div>

          <h2 className="section-heading">{t('relations.topConnected')}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('common.file')}</th>
                  <th>{t('common.language')}</th>
                  <th>{t('relations.incoming')}</th>
                  <th>{t('relations.outgoing')}</th>
                  <th>{t('common.code')}</th>
                </tr>
              </thead>
              <tbody>
                {topConnectedFiles.map(node => (
                  <tr key={node.id} className="clickable-row" onClick={() => navigate(`/editor/${encodeURIComponent(node.relPath)}`)}>
                    <td className="mono">{node.relPath}</td>
                    <td>{node.lang}</td>
                    <td>{node.incoming.toLocaleString(locale)}</td>
                    <td>{node.outgoing.toLocaleString(locale)}</td>
                    <td>{node.code.toLocaleString(locale)}</td>
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