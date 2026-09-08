// synced from mysql-compare/src/renderer/components/ui — Doge Desktop Design System
import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption, EChartsType, SetOptionOpts } from 'echarts/core';
import {
  BarChart,
  GraphChart,
  HeatmapChart,
  PieChart,
  SankeyChart,
  TreemapChart,
} from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { cn } from '../../lib/utils';
import { Spinner } from './spinner';

echarts.use([
  BarChart,
  GraphChart,
  HeatmapChart,
  PieChart,
  SankeyChart,
  TreemapChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

const DEFAULT_SET_OPTION: SetOptionOpts = { notMerge: true, lazyUpdate: true };

export interface ChartTokens {
  /** `--ds-chart-1..8`, in order. Assign in sequence, never cycle. */
  categorical: string[];
  /** `--ds-chart-ord-1..5` — discrete ordered buckets. */
  ordinal: string[];
  sequential: [string, string];
  sequentialAlt: [string, string];
  diverging: [string, string, string];
  ink: string;
  inkMuted: string;
  grid: string;
  axis: string;
  surface: string;
  tooltipBg: string;
  tooltipBorder: string;
  markRing: string;
}

function readChartTokens(): ChartTokens {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string): string => cs.getPropertyValue(name).trim();
  return {
    categorical: [1, 2, 3, 4, 5, 6, 7, 8].map(i => v(`--ds-chart-${i}`)),
    ordinal: [1, 2, 3, 4, 5].map(i => v(`--ds-chart-ord-${i}`)),
    sequential: [v('--ds-chart-seq-min'), v('--ds-chart-seq-max')],
    sequentialAlt: [v('--ds-chart-seq-alt-min'), v('--ds-chart-seq-alt-max')],
    diverging: [v('--ds-chart-div-neg'), v('--ds-chart-div-mid'), v('--ds-chart-div-pos')],
    ink: v('--ds-chart-ink'),
    inkMuted: v('--ds-chart-ink-muted'),
    grid: v('--ds-chart-grid'),
    axis: v('--ds-chart-axis'),
    surface: v('--ds-chart-surface'),
    tooltipBg: v('--ds-chart-tooltip-bg'),
    tooltipBorder: v('--ds-chart-tooltip-border'),
    markRing: v('--ds-chart-mark-ring'),
  };
}

/**
 * Re-reads the palette from CSS on every theme flip. One observer covers both
 * theme hooks (`class="dark"` and `data-theme`).
 */
export function useChartTokens(): ChartTokens {
  const [tokens, setTokens] = useState<ChartTokens>(() => readChartTokens());
  useEffect(() => {
    const observer = new MutationObserver(() => setTokens(readChartTokens()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => observer.disconnect();
  }, []);
  return tokens;
}

export interface ChartPerfEvent {
  phase: 'init' | 'setOption' | 'rendered' | 'finished';
  details: Record<string, string | number | boolean | null | undefined>;
}

export interface ChartProps {
  option: EChartsCoreOption | ((tokens: ChartTokens) => EChartsCoreOption);
  height?: number | string;
  onEvents?: Record<string, (params: unknown, chart: EChartsType) => void>;
  /** REQUIRED. */
  ariaLabel: string;
  /**
   * The relief channel for the light-mode sub-3:1 slots (aqua/yellow/magenta).
   * A chart using those slots without one is a defect (DESIGN-SYSTEM §1.6).
   */
  tableFallback?: React.ReactNode;
  loading?: boolean;
  empty?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  settings?: SetOptionOpts;
  onPerfEvent?: (event: ChartPerfEvent) => void;
  perfLabel?: string;
}

/**
 * ECharts wrapper that reads tokens from CSS vars instead of substituting hexes.
 * Keeps the tree-shaken registry, the ResizeObserver and the perf instrumentation.
 */
export function Chart({
  option,
  height = '100%',
  onEvents,
  ariaLabel,
  tableFallback,
  loading,
  empty,
  className,
  style,
  settings = DEFAULT_SET_OPTION,
  onPerfEvent,
  perfLabel,
}: ChartProps) {
  const tokens = useChartTokens();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const perfRef = useRef(onPerfEvent);
  const labelRef = useRef(perfLabel);
  const seqRef = useRef(0);
  const startRef = useRef<{ seq: number; startedAt: number } | null>(null);
  const pendingRendered = useRef<number | null>(null);
  const pendingFinished = useRef<number | null>(null);

  const resolved = useMemo(
    () => (typeof option === 'function' ? option(tokens) : option),
    [option, tokens],
  );

  useEffect(() => {
    perfRef.current = onPerfEvent;
    labelRef.current = perfLabel;
  }, [onPerfEvent, perfLabel]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || loading || empty) return undefined;

    function emit(event: ChartPerfEvent): void {
      if (labelRef.current) console.info(`[${labelRef.current}] ${event.phase}`, event.details);
      perfRef.current?.(event);
    }

    const chart = echarts.init(container, undefined, { renderer: 'canvas', useDirtyRect: true });
    chartRef.current = chart;

    emit({
      phase: 'init',
      details: {
        width: Math.round(container.clientWidth),
        height: Math.round(container.clientHeight),
        renderer: 'canvas',
        dirtyRect: true,
      },
    });

    function handleRendered(): void {
      const pending = startRef.current;
      if (!pending || pendingRendered.current !== pending.seq) return;
      emit({
        phase: 'rendered',
        details: { seq: pending.seq, elapsedMs: Number((performance.now() - pending.startedAt).toFixed(1)) },
      });
      pendingRendered.current = null;
    }

    function handleFinished(): void {
      const pending = startRef.current;
      if (!pending || pendingFinished.current !== pending.seq) return;
      emit({
        phase: 'finished',
        details: { seq: pending.seq, elapsedMs: Number((performance.now() - pending.startedAt).toFixed(1)) },
      });
      pendingFinished.current = null;
      if (pendingRendered.current === null) startRef.current = null;
    }

    chart.on('rendered', handleRendered);
    chart.on('finished', handleFinished);

    const resize = (): void => chart.resize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(container);
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      observer?.disconnect();
      chart.off('rendered', handleRendered);
      chart.off('finished', handleFinished);
      chart.dispose();
      chartRef.current = null;
    };
  }, [loading, empty]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    const startedAt = performance.now();
    startRef.current = { seq, startedAt };
    pendingRendered.current = seq;
    pendingFinished.current = seq;
    chart.setOption(resolved, settings);
    if (labelRef.current) {
      console.info(`[${labelRef.current}] setOption`, {
        seq,
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
      });
    }
    perfRef.current?.({
      phase: 'setOption',
      details: { seq, durationMs: Number((performance.now() - startedAt).toFixed(1)) },
    });
  }, [resolved, settings]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents) return undefined;
    const bindings = Object.entries(onEvents).map(([name, handler]) => {
      const listener = (params: unknown): void => handler(params, chart);
      chart.on(name, listener);
      return { name, listener };
    });
    return () => {
      for (const { name, listener } of bindings) chart.off(name, listener);
    };
  }, [onEvents]);

  return (
    <figure className={cn('m-0 flex min-w-0 flex-col gap-2', className)}>
      <div
        role="img"
        aria-label={ariaLabel}
        className="relative min-h-0 w-full"
        style={{ height, ...style }}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner size="md" />
          </div>
        ) : empty ? (
          empty
        ) : (
          <div ref={containerRef} className="h-full w-full" />
        )}
      </div>
      {tableFallback}
    </figure>
  );
}
