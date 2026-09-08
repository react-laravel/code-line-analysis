import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

let server;
let model;
let routeChartOption;
const t = key => key;
const tokens = {
  categorical: ['#0088cc', '#00aa88', '#aa8800', '#8844cc', '#cc4400', '#668800', '#448899', '#cc4488'],
  ordinal: ['#334455', '#445566', '#556677', '#667788', '#778899'],
  sequential: ['#eef8ff', '#0088cc'], ink: '#222222', inkMuted: '#666666',
  surface: '#ffffff', tooltipBg: '#ffffff', tooltipBorder: '#cccccc',
  grid: '#eeeeee', axis: '#cccccc', markRing: '#222222',
};
const route = (path, methods, sourceFile = 'routes/api.php', framework = 'laravel') => ({
  path, methods, sourceFile, framework, handler: 'Controller@handle', routeName: null,
});
const routes = [
  route('/api/users', ['GET']),
  route('/api/users/{id}', ['PUT', 'PATCH', 'put']),
  route('/api/orders', ['GET', 'POST'], 'routes/orders.php'),
  route('/docs', ['PAGE'], 'app/docs/page.tsx', 'next-app'),
];

before(async () => {
  server = await createServer({
    configFile: false, appType: 'custom',
    esbuild: { jsx: 'automatic' },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  model = await server.ssrLoadModule('/src/renderer/views/architecture/routes-model.ts');
  ({ routeChartOption } = await server.ssrLoadModule('/src/renderer/views/architecture/ApiRoutesGraph.tsx'));
  echarts.use(SVGRenderer);
});

after(async () => { await server?.close(); });

function context(variant, input = routes) {
  return {
    variant, locale: 'en-US', t, seed: 0,
    flow: model.buildRouteFlowGraph(input, 2, t),
    hierarchy: model.buildRouteHierarchy(input, 2, t),
    analysis: model.buildRouteAnalysisChart(input, 2, t),
  };
}

test('route counts, distinct source files and request methods remain separate', () => {
  const analysis = context('heatmap').analysis;
  const users = analysis.groups.find(group => group.label === '/api/users');
  assert.equal(users.routeCount, 2);
  assert.equal(users.sourceCount, 1);
  assert.equal(users.methodCount, 3);
  assert.deepEqual(users.methodCounts, { GET: 1, POST: 0, PUT: 1, PATCH: 1, PAGE: 0 });
  assert.equal(analysis.groups[0], users);
});

test('multi-method routes conserve the Sankey flow at every path group', () => {
  const { flow } = context('sankey');
  for (const group of flow.nodes.filter(node => node.kind === 'group')) {
    const incoming = flow.links.filter(link => link.target === group.name).reduce((sum, link) => sum + link.value, 0);
    const outgoing = flow.links.filter(link => link.source === group.name).reduce((sum, link) => sum + link.value, 0);
    assert.equal(incoming, outgoing);
    assert.equal(incoming, group.methodCount);
  }
  assert.equal(flow.nodes.find(node => node.name === 'framework:laravel').routeCount, 3);
  assert.equal(flow.nodes.find(node => node.name === 'framework:laravel').methodCount, 5);
});

test('treemap areas count each route once and do not repeat it for methods', () => {
  const { root } = context('treemap').hierarchy;
  assert.equal(root.value, routes.length);
  assert.equal(root.children.reduce((sum, node) => sum + node.value, 0), routes.length);
  for (const framework of root.children) {
    assert.equal(framework.children.reduce((sum, node) => sum + node.value, 0), framework.value);
    for (const group of framework.children) assert.equal(group.children, undefined);
  }
});

test('identical path prefixes in different frameworks remain separate', () => {
  const analysis = context('heatmap', [
    route('/docs', ['GET']), route('/docs', ['PAGE'], 'app/docs/page.tsx', 'next-app'),
  ]).analysis;
  assert.equal(analysis.groupCount, 2);
  assert.notEqual(analysis.groups[0].key, analysis.groups[1].key);
});

test('chart clicks match the exact path group rather than similar path substrings', () => {
  const group = { framework: 'laravel', prefix: '/api/orders', depth: 2 };
  assert.equal(model.matchesRouteChartGroup(route('/api/orders/12', ['GET']), group), true);
  assert.equal(model.matchesRouteChartGroup(route('/api/orders-export', ['GET']), group), false);
  assert.equal(model.matchesRouteChartGroup(route('/api/orders', ['PAGE'], 'app/page.tsx', 'next-app'), group), false);
  assert.equal(model.matchesRouteChartGroup(route('/api/orders', ['GET']), { ...group, prefix: '/api' }), false);
  assert.equal(model.matchesRouteChartGroup(route('/', ['GET']), { ...group, prefix: '/' }), true);
});

test('heatmap and bar marks carry path-group filters and correct tooltip counts', () => {
  for (const variant of ['heatmap', 'stackedBar']) {
    const option = routeChartOption(tokens, context(variant));
    const data = option.series[0].data.find(item => item.displayName === '/api/users');
    assert.equal(data.kind, 'group');
    assert.equal(data.framework, 'laravel');
    assert.equal(data.sourceCount, 1);
    const tooltip = option.tooltip.formatter({ data });
    assert.match(tooltip, /apiRoutes.routes: 2/);
    assert.match(tooltip, /common.files: 1/);
    assert.match(tooltip, /apiRoutes.methodMatches: 1/);
  }
});

test('a request method keeps its color after filtering out earlier methods', () => {
  const option = routeChartOption(tokens, context('stackedBar'));
  const filtered = routeChartOption(tokens, context('stackedBar', [route('/api/orders', ['POST'])]));
  const before = option.series.find(series => series.name === 'POST').itemStyle.color;
  assert.equal(filtered.series[0].itemStyle.color, before);
});

test('filled marks use contrasting labels in light and dark themes', () => {
  for (const palette of [
    { ...tokens, ink: '#e6edf3', surface: '#101820', sequential: ['#14304f', '#b7d3f6'], ordinal: ['#d6e6fb', '#adcdf7', '#80abe9'] },
    { ...tokens, ink: '#17212b', surface: '#ffffff', sequential: ['#cde2fb', '#0d366b'] },
  ]) {
    const heatmap = routeChartOption(palette, context('heatmap'));
    const cell = heatmap.series[0].data.find(item => item.value[2] === 1);
    assert.equal(cell.label.color, palette.surface);
  }
  const dark = { ...tokens, ink: '#e6edf3', surface: '#101820', ordinal: ['#d6e6fb', '#adcdf7', '#80abe9'] };
  const treemap = routeChartOption(dark, context('treemap'));
  assert.equal(treemap.series[0].data[0].children[0].label.color, dark.surface);
});

test('large comparisons keep every group and use a bounded scroll window', () => {
  const manyRoutes = Array.from({ length: 75 }, (_, index) => route(`/api/group-${index}`, ['GET']));
  for (const variant of ['heatmap', 'stackedBar']) {
    const ctx = context(variant, manyRoutes);
    const option = routeChartOption(tokens, ctx);
    assert.equal(option.yAxis.data.length, 75);
    assert.equal(option.series[0].data.length, 75);
    assert.equal(option.dataZoom[0].endValue, 19);
    assert.equal(ctx.analysis.chartHeight, 680);
  }
});

test('retained charts render using the registered components, including row scrolling', () => {
  const manyRoutes = Array.from({ length: 25 }, (_, index) => route(`/api/group-${index}`, ['GET', 'POST']));
  for (const variant of ['stackedBar', 'heatmap', 'treemap', 'sankey']) {
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 960, height: 680 });
    try {
      chart.setOption({ ...routeChartOption(tokens, context(variant, manyRoutes)), animation: false });
      const svg = chart.renderToSVGString();
      assert.match(svg, /<path/);
      assert.doesNotMatch(svg, /NaN/);
      if (variant === 'heatmap' || variant === 'stackedBar') {
        assert.equal(chart.getOption().dataZoom[0].endValue, 19);
        chart.dispatchAction({ type: 'dataZoom', startValue: 5, endValue: 24 });
        assert.equal(chart.getOption().dataZoom[0].startValue, 5);
      }
    } finally {
      chart.dispose();
    }
  }
});
