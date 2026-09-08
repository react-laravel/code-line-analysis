import { useCallback, useMemo, useRef, useState } from 'react';
import type { EChartsType } from 'echarts/core';
import type { FolderRow } from '../../../shared/api';
import { StatTile, toast, type MenuItem } from '../../components/ui';
import { useI18n } from '../../i18n';

/** The three lenses of the Architecture view (blueprint §2.4). */
export type ArchLensId = 'routes' | 'imports' | 'schema';

export const ARCH_LENS_IDS: ArchLensId[] = ['routes', 'imports', 'schema'];

export function parseArchLens(raw: string | null): ArchLensId {
  return ARCH_LENS_IDS.find(id => id === raw) ?? 'routes';
}

export interface ArchLensArgs {
  folder: FolderRow;
  /** The toolbar's shared search box; only the Routes lens consumes it today. */
  query: string;
  /** Clicking a graph node writes its prefix back into the shared search box. */
  setQuery: (value: string) => void;
  /** Only the visible lens fetches; the others keep whatever they had. */
  active: boolean;
}

/**
 * What a lens hands back to `ArchitectureView`, which owns the one `Toolbar`
 * the three of them share.
 */
export interface ArchLens {
  /** Rows/nodes available in this lens, for its chip. `undefined` until known. */
  count?: number;
  /**
   * `false` marks the lens as unavailable in this folder (Schema without a
   * Laravel project). The chip stays listed and selectable — it explains
   * itself rather than vanishing from the nav and redirecting you off it,
   * which is what `App.tsx:389-397` used to do.
   */
  available?: boolean;
  /** High-frequency controls for the toolbar's action cluster. */
  actions?: React.ReactNode;
  /** The toolbar's second row while this lens is active. */
  filters?: React.ReactNode;
  /** Demoted, lens-specific actions for the toolbar `⋯`. */
  overflow?: MenuItem[];
  /**
   * Extra verbs for `⌘K` only — things that already have a good primary
   * affordance but must still be reachable by name (the Routes lens's
   * chart variants live behind "View as ▾", blueprint §2.8).
   */
  commands?: MenuItem[];
  subtitle?: React.ReactNode;
  /** Absent means this lens has no search box, so none is rendered. */
  searchPlaceholder?: string;
  content: React.ReactNode;
}

export type ChartEvents = Record<string, (params: unknown, chart: EChartsType) => void>;

export interface GraphMenu {
  /**
   * Bump on "Re-layout graph". Feed it into the option builder (the series
   * `id`) so `Chart`'s `notMerge` pass rebuilds the series and the layout
   * simulation restarts from a fresh seed.
   */
  seed: number;
  /** Pass to `Chart.onEvents` — captures the instance for the PNG export. */
  onEvents: ChartEvents;
  items: MenuItem[];
}

export interface GraphMenuOptions {
  /** `false` in list mode: the chart-only entries drop out of the `⋯`. */
  graph: boolean;
  /** Layout-placed variants can be re-seeded; axis-bound ones cannot. */
  relayoutable?: boolean;
  /** File stem for the exported PNG. */
  fileName: string;
  /** The serialisable model behind the current view, for "Copy graph data". */
  data: () => unknown;
  onReset: () => void;
  resetDisabled?: boolean;
  /** Merged under the instance capture, so a lens keeps its own click handler. */
  chartEvents?: ChartEvents;
}

/**
 * The `⋯` overflow every Architecture lens shares (blueprint §2.4):
 * Re-layout graph · Export PNG · Copy graph data · Reset filters.
 *
 * The chart instance is captured from ECharts' own `finished` event rather than
 * by threading a ref through the `Chart` primitive, so the vendored package
 * stays untouched.
 */
export function useGraphMenu({
  graph,
  relayoutable = true,
  fileName,
  data,
  onReset,
  resetDisabled,
  chartEvents,
}: GraphMenuOptions): GraphMenu {
  const { t } = useI18n();
  const chartRef = useRef<EChartsType | null>(null);
  const [seed, setSeed] = useState(0);

  const onEvents = useMemo<ChartEvents>(() => ({
    ...chartEvents,
    finished: (_params, chart) => {
      chartRef.current = chart;
    },
  }), [chartEvents]);

  const exportPng = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      const surface = getComputedStyle(document.documentElement)
        .getPropertyValue('--ds-chart-surface')
        .trim();
      const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: surface || undefined });
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${fileName}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      toast.show({ tone: 'danger', title: t('architecture.exportFailed'), details: String(error) });
    }
  }, [fileName, t]);

  const copyData = useCallback(() => {
    const payload = JSON.stringify(data(), null, 2);
    void navigator.clipboard?.writeText(payload)
      .then(() => toast.show({ tone: 'success', title: t('architecture.copied') }))
      .catch((error: unknown) => toast.show({
        tone: 'danger',
        title: t('architecture.copyFailed'),
        details: String(error),
      }));
  }, [data, t]);

  const items = useMemo<MenuItem[]>(() => {
    const list: MenuItem[] = [];
    if (graph) {
      if (relayoutable) {
        list.push({ id: 'relayout', label: t('architecture.relayout'), onSelect: () => setSeed(current => current + 1) });
      }
      list.push({ id: 'export-png', label: t('architecture.exportPng'), onSelect: exportPng });
    }
    list.push({ id: 'copy-data', label: t('architecture.copyData'), onSelect: copyData });
    list.push({ kind: 'separator', id: 'sep-reset' });
    list.push({
      id: 'reset-filters',
      label: t('architecture.resetFilters'),
      disabled: resetDisabled,
      onSelect: onReset,
    });
    return list;
  }, [copyData, exportPng, graph, onReset, relayoutable, resetDisabled, t]);

  return { seed, onEvents, items };
}

/**
 * The metric strip that used to sit above each graph as `card metric-card`
 * blocks. Wide screens get the tiles; narrower ones fold the same numbers into
 * the toolbar subtitle, exactly as the Code lenses do.
 */
export interface ArchMetric {
  label: string;
  value: string;
}

export function ArchMetrics({ items }: { items: ArchMetric[] }) {
  if (items.length === 0) return null;
  return (
    <div className="hidden grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 min-[1200px]:grid">
      {items.map(item => (
        <StatTile key={item.label} label={item.label} value={item.value} />
      ))}
    </div>
  );
}

/** The same numbers as one line, for the toolbar subtitle under 1200px. */
export function ArchMetricsText({ items }: { items: ArchMetric[] }) {
  if (items.length === 0) return null;
  return (
    <span className="min-[1200px]:hidden">
      {items.map(item => `${item.label} ${item.value}`).join(' · ')}
    </span>
  );
}
