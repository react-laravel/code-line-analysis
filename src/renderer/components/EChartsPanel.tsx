import React, { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption, EChartsType, SetOptionOpts } from 'echarts/core';
import { BarChart, GraphChart, HeatmapChart, PieChart, SankeyChart, SunburstChart, TreemapChart, TreeChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useTheme, type ThemeMode } from '../theme';

echarts.use([BarChart, GraphChart, HeatmapChart, PieChart, SankeyChart, SunburstChart, TreemapChart, TreeChart, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

const DEFAULT_SET_OPTION: SetOptionOpts = { notMerge: true, lazyUpdate: true };

const LIGHT_CHART_COLORS: Record<string, string> = {
  '#e6edf3': '#1b2731',
  '#ffffff': '#1b2731',
  '#a7b0bd': '#63717d',
  '#8b949e': '#63717d',
  '#2a313c': '#d4dde4',
  '#161b22': '#ffffff',
  '#111722': '#f4f7f9',
  '#202834': '#eef3f6',
  '#1a212b': '#f4f7f9',
  '#151c24': '#f7f9fb',
  '#141922': '#ffffff',
  'rgba(139, 148, 158, 0.18)': 'rgba(74, 91, 104, 0.16)',
};

function lightChartColor(value: string): string {
  const mapped = LIGHT_CHART_COLORS[value.toLowerCase()];
  if (mapped) return mapped;
  if (/^rgba\(255,\s*255,\s*255,/.test(value)) {
    return value.replace(/^rgba\(255,\s*255,\s*255,/, 'rgba(54, 73, 86,');
  }
  return value;
}

function adaptOptionToTheme(value: unknown, theme: ThemeMode): unknown {
  if (theme === 'dark') return value;
  if (typeof value === 'string') return lightChartColor(value);
  if (Array.isArray(value)) return value.map(item => adaptOptionToTheme(item, theme));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, adaptOptionToTheme(item, theme)]),
    );
  }
  return value;
}

export interface EChartsPerfEvent {
  phase: 'init' | 'setOption' | 'rendered' | 'finished';
  details: Record<string, string | number | boolean | null | undefined>;
}

interface Props {
  option: EChartsCoreOption;
  className?: string;
  onEvents?: Record<string, (params: unknown, chart: EChartsType) => void>;
  onPerfEvent?: (event: EChartsPerfEvent) => void;
  perfLabel?: string;
  style?: React.CSSProperties;
  settings?: SetOptionOpts;
}

export default function EChartsPanel({ option, className, onEvents, onPerfEvent, perfLabel, style, settings = DEFAULT_SET_OPTION }: Props) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const onPerfEventRef = useRef<Props['onPerfEvent']>(onPerfEvent);
  const perfLabelRef = useRef(perfLabel);
  const optionSeqRef = useRef(0);
  const optionStartRef = useRef<{ seq: number; startedAt: number } | null>(null);
  const pendingRenderedSeqRef = useRef<number | null>(null);
  const pendingFinishedSeqRef = useRef<number | null>(null);
  const themedOption = useMemo(
    () => adaptOptionToTheme(option, theme) as EChartsCoreOption,
    [option, theme],
  );

  function emitPerfEvent(event: EChartsPerfEvent) {
    if (perfLabelRef.current) console.info(`[${perfLabelRef.current}] ${event.phase}`, event.details);
    onPerfEventRef.current?.(event);
  }

  useEffect(() => {
    onPerfEventRef.current = onPerfEvent;
    perfLabelRef.current = perfLabel;
  }, [onPerfEvent, perfLabel]);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const chart = echarts.init(containerRef.current, undefined, { renderer: 'canvas', useDirtyRect: true });
    chartRef.current = chart;

    emitPerfEvent({
      phase: 'init',
      details: {
        width: Math.round(containerRef.current.clientWidth),
        height: Math.round(containerRef.current.clientHeight),
        renderer: 'canvas',
        dirtyRect: true,
      },
    });

    const handleRendered = () => {
      const pending = optionStartRef.current;
      if (!pending || pendingRenderedSeqRef.current !== pending.seq) return;

      emitPerfEvent({
        phase: 'rendered',
        details: {
          seq: pending.seq,
          elapsedMs: Number((performance.now() - pending.startedAt).toFixed(1)),
        },
      });
      pendingRenderedSeqRef.current = null;
    };

    const handleFinished = () => {
      const pending = optionStartRef.current;
      if (!pending || pendingFinishedSeqRef.current !== pending.seq) return;

      emitPerfEvent({
        phase: 'finished',
        details: {
          seq: pending.seq,
          elapsedMs: Number((performance.now() - pending.startedAt).toFixed(1)),
        },
      });
      pendingFinishedSeqRef.current = null;
      if (pendingRenderedSeqRef.current == null) optionStartRef.current = null;
    };

    chart.on('rendered', handleRendered);
    chart.on('finished', handleFinished);

    const resizeChart = () => chart.resize();
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resizeChart) : null;
    resizeObserver?.observe(containerRef.current);
    window.addEventListener('resize', resizeChart);

    return () => {
      window.removeEventListener('resize', resizeChart);
      resizeObserver?.disconnect();
      chart.off('rendered', handleRendered);
      chart.off('finished', handleFinished);
      chart.dispose();
      chartRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const seq = optionSeqRef.current + 1;
    optionSeqRef.current = seq;
    const startedAt = performance.now();
    optionStartRef.current = { seq, startedAt };
    pendingRenderedSeqRef.current = seq;
    pendingFinishedSeqRef.current = seq;

    chart.setOption(themedOption, settings);

    emitPerfEvent({
      phase: 'setOption',
      details: {
        seq,
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
      },
    });
  }, [settings, themedOption]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents) return undefined;

    const bindings = Object.entries(onEvents).map(([eventName, handler]) => {
      const listener = (params: unknown) => handler(params, chart);
      chart.on(eventName, listener);
      return { eventName, listener };
    });

    return () => {
      bindings.forEach(({ eventName, listener }) => chart.off(eventName, listener));
    };
  }, [onEvents]);

  return (
    <div
      ref={containerRef}
      className={className ? `echarts-panel ${className}` : 'echarts-panel'}
      style={{ width: '100%', height: '100%', minHeight: 0, ...style }}
    />
  );
}
