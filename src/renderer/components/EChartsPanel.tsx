import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption, EChartsType, SetOptionOpts } from 'echarts/core';
import { BarChart, GraphChart, HeatmapChart, PieChart, SankeyChart, SunburstChart, TreemapChart, TreeChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, GraphChart, HeatmapChart, PieChart, SankeyChart, SunburstChart, TreemapChart, TreeChart, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

const DEFAULT_SET_OPTION: SetOptionOpts = { notMerge: true, lazyUpdate: true };

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const onPerfEventRef = useRef<Props['onPerfEvent']>(onPerfEvent);
  const perfLabelRef = useRef(perfLabel);
  const optionSeqRef = useRef(0);
  const optionStartRef = useRef<{ seq: number; startedAt: number } | null>(null);
  const pendingRenderedSeqRef = useRef<number | null>(null);
  const pendingFinishedSeqRef = useRef<number | null>(null);

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
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const seq = optionSeqRef.current + 1;
    optionSeqRef.current = seq;
    const startedAt = performance.now();
    optionStartRef.current = { seq, startedAt };
    pendingRenderedSeqRef.current = seq;
    pendingFinishedSeqRef.current = seq;

    chart.setOption(option, settings);

    emitPerfEvent({
      phase: 'setOption',
      details: {
        seq,
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
      },
    });
  }, [option, settings]);

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