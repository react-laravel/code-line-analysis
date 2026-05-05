import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption, EChartsType, SetOptionOpts } from 'echarts/core';
import { BarChart, GraphChart, PieChart, TreeChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, GraphChart, PieChart, TreeChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const DEFAULT_SET_OPTION: SetOptionOpts = { notMerge: true, lazyUpdate: true };

interface Props {
  option: EChartsCoreOption;
  className?: string;
  onEvents?: Record<string, (params: unknown, chart: EChartsType) => void>;
  style?: React.CSSProperties;
  settings?: SetOptionOpts;
}

export default function EChartsPanel({ option, className, onEvents, style, settings = DEFAULT_SET_OPTION }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const chart = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;

    const resizeChart = () => chart.resize();
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resizeChart) : null;
    resizeObserver?.observe(containerRef.current);
    window.addEventListener('resize', resizeChart);

    return () => {
      window.removeEventListener('resize', resizeChart);
      resizeObserver?.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, settings);
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