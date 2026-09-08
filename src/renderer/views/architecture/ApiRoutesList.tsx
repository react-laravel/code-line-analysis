import React, { useMemo } from 'react';
import type { ApiRouteEntry } from '../../../shared/api';
import PathCell from '../../components/PathCell';
import { Badge, DataTable, Panel, type BadgeProps, type Column } from '../../components/ui';
import {
  methodLabel,
  routeKey,
  tailPath,
  type FrameworkRouteSection,
  type Translate,
} from './routes-model';
import { frameworkLabel } from './routes-model';

/**
 * List mode of the Routes lens. Split out of the 1375-line `ApiRoutesView`
 * (ADOPTION §1.4); `ApiRoutesGraph.tsx` owns the chart variants.
 *
 * The bespoke `buildColumnPlan` summary-column mechanism is the app-local
 * column factory the blueprint's risk 1 recommends: uniform columns collapse
 * into chips above the table, and everything else becomes a
 * `Column<ApiRouteEntry>[]` for `DataTable`.
 */

/**
 * The last page-scoped rules in `styles.css` were the nine `.api-method-*`
 * chips; chunk 12 re-tones them onto `Badge`.
 *
 * The four write verbs keep exactly the hues the stylesheet gave them
 * (`--ds-success-text` / `--ds-running-text` / `--ds-warning-text` /
 * `--ds-danger-text`), so nothing about scanning a route table changes. What
 * goes away is `PAGE`, which was painted with the chart token `--ds-chart-7` —
 * a categorical *series* colour on a non-chart. `PAGE` is not an HTTP verb at
 * all (it is a rendered page route), so it takes the neutral tone and an
 * `outline` fill: a different *form*, not a colliding hue. The method name is
 * always printed, so colour stays the redundant channel (DESIGN-SYSTEM §0).
 */
const METHOD_TONE: Record<string, { tone: BadgeProps['tone']; variant?: BadgeProps['variant'] }> = {
  GET: { tone: 'success' },
  POST: { tone: 'running' },
  PUT: { tone: 'warning' },
  PATCH: { tone: 'warning' },
  DELETE: { tone: 'danger' },
  PAGE: { tone: 'neutral', variant: 'outline' },
};

function MethodChip({ method, t }: { method: string; t: Translate }) {
  const { tone, variant } = METHOD_TONE[method.toUpperCase()] ?? { tone: 'neutral' as const };
  return (
    <Badge tone={tone} variant={variant} className="min-w-11 justify-center font-mono">
      {methodLabel(method, t)}
    </Badge>
  );
}

function allSame<T>(arr: T[]): boolean {
  if (arr.length <= 1) return true;
  return arr.every(item => item === arr[0]);
}

interface PlanColumn {
  header: string;
  key: string;
  render: (route: ApiRouteEntry) => React.ReactNode;
  summary?: React.ReactNode;
}

export function buildColumnPlan(
  routes: ApiRouteEntry[],
  groupDepth: number | null,
  t: Translate,
): PlanColumn[] {
  if (routes.length === 0) return [];

  const methods = routes.map(route => route.methods.join(','));
  const handlers = routes.map(route => route.handler);
  const routeNames = routes.map(route => route.routeName ?? '-');
  const sources = routes.map(route => route.sourceFile);

  const plan: PlanColumn[] = [
    { header: t('apiRoutes.path'), key: 'path', render: route => <span className="font-mono text-xs">{tailPath(route.path, groupDepth)}</span> },
  ];

  if (!allSame(methods)) {
    plan.unshift({
      header: t('apiRoutes.methods'),
      key: 'methods',
      render: route => (
        <div className="flex flex-wrap gap-1.5">
          {route.methods.map(method => (
            <MethodChip key={method} method={method} t={t} />
          ))}
        </div>
      ),
    });
  } else if (methods.length > 0) {
    const sample = routes[0].methods;
    plan.unshift({
      header: t('apiRoutes.methods'),
      key: 'methods',
      render: () => (
        <div className="flex flex-wrap gap-1.5">
          {sample.map(method => (
            <MethodChip key={method} method={method} t={t} />
          ))}
        </div>
      ),
      summary: (
        <Badge>
          {t('apiRoutes.methods')}: {sample.map(method => methodLabel(method, t)).join(', ')}
        </Badge>
      ),
    });
  }

  if (!allSame(handlers)) {
    plan.splice(plan.findIndex(col => col.key === 'path'), 0, {
      header: t('apiRoutes.handler'),
      key: 'handler',
      render: route => <span className="font-mono text-xs">{route.handler}</span>,
    });
  } else if (handlers.length > 0) {
    const sample = routes[0].handler;
    plan.splice(plan.findIndex(col => col.key === 'path'), 0, {
      header: t('apiRoutes.handler'),
      key: 'handler',
      render: () => <span className="font-mono text-xs">{sample}</span>,
      summary: <Badge>{t('apiRoutes.handler')}: {sample}</Badge>,
    });
  }

  if (!allSame(routeNames)) {
    plan.splice(plan.findIndex(col => col.key === 'path') + 1, 0, {
      header: t('apiRoutes.routeName'),
      key: 'routeName',
      render: route => <span className="font-mono text-xs">{route.routeName ?? '-'}</span>,
    });
  } else if (routeNames.length > 0 && routeNames[0] !== '-') {
    const sample = routes[0].routeName!;
    plan.splice(plan.findIndex(col => col.key === 'path') + 1, 0, {
      header: t('apiRoutes.routeName'),
      key: 'routeName',
      render: () => <span className="font-mono text-xs">{sample}</span>,
      summary: <Badge>{t('apiRoutes.routeName')}: {sample}</Badge>,
    });
  }

  // Source is not seeded on `plan`. Methods / handler / routeName follow the
  // same rule: a column that is always present *and* pushed here would render
  // twice. The seed is path only; this branch is the one source column.
  if (!allSame(sources)) {
    plan.splice(plan.length, 0, {
      header: t('apiRoutes.source'),
      key: 'source',
      render: route => <PathCell path={route.sourceFile} />,
    });
  } else if (sources.length > 0) {
    const sample = routes[0].sourceFile;
    plan.push({
      header: t('apiRoutes.source'),
      key: 'source',
      render: () => <span className="font-mono text-xs">{sample}</span>,
      summary: <Badge>{t('apiRoutes.source')}: {sample}</Badge>,
    });
  }

  return plan;
}

function RouteTable({
  routes,
  groupDepth,
  onOpen,
  t,
}: {
  routes: ApiRouteEntry[];
  groupDepth: number | null;
  onOpen: (sourceFile: string) => void;
  t: Translate;
}) {
  const columnPlan = useMemo(() => buildColumnPlan(routes, groupDepth, t), [routes, groupDepth, t]);
  const summaryItems = columnPlan.filter(col => col.summary);
  const columns = useMemo<Column<ApiRouteEntry>[]>(
    () => columnPlan
      .filter(col => !col.summary)
      .map(col => ({ id: col.key, header: col.header, cell: (route: ApiRouteEntry) => col.render(route) })),
    [columnPlan],
  );

  return (
    <div>
      {summaryItems.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {summaryItems.map(col => (
            <span key={col.key}>{col.summary}</span>
          ))}
        </div>
      )}
      <DataTable
        aria-label={t('apiRoutes.title')}
        columns={columns}
        rows={routes}
        rowKey={route => routeKey(route)}
        onRowActivate={route => onOpen(route.sourceFile)}
      />
    </div>
  );
}

export default function ApiRoutesList({
  sections,
  visibleDepth,
  locale,
  onOpen,
  t,
}: {
  sections: FrameworkRouteSection[];
  visibleDepth: number | null;
  locale: string;
  onOpen: (sourceFile: string) => void;
  t: Translate;
}) {
  return (
    <div className="grid gap-4">
      {sections.map(section => (
        <section key={section.framework} className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm font-medium">{frameworkLabel(section.framework, t)}</strong>
            <Badge>{section.routes.length.toLocaleString(locale)}</Badge>
          </div>

          {visibleDepth == null ? (
            <RouteTable routes={section.routes} groupDepth={null} onOpen={onOpen} t={t} />
          ) : (
            <div className="grid gap-3">
              {section.groups.map(group => (
                <Panel key={group.key} padded={false} className="overflow-hidden">
                  <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                    <strong className="font-mono text-sm font-medium">{group.label}</strong>
                    <Badge>{group.routes.length.toLocaleString(locale)}</Badge>
                  </div>
                  <RouteTable routes={group.routes} groupDepth={visibleDepth} onOpen={onOpen} t={t} />
                </Panel>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
