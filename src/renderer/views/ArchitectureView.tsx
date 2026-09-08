import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Database, Info, Route as RouteIcon, Share2 } from 'lucide-react';
import type { FolderRow } from '../../shared/api';
import { SearchInput, ToggleGroup, Toolbar, type ToggleOption } from '../components/ui';
import NoFolderState from '../components/NoFolderState';
import { commandsFromMenu, useRegisterCommands } from '../hooks/useCommands';
import { useI18n } from '../i18n';
import { useRoutesLens } from './architecture/RoutesLens';
import { useImportsLens } from './architecture/ImportsLens';
import { useSchemaLens } from './architecture/SchemaLens';
import { ARCH_LENS_IDS, parseArchLens, type ArchLens, type ArchLensId } from './architecture/lens';

const LENS_ICON = {
  routes: RouteIcon,
  imports: Share2,
  schema: Database,
} as const;

interface Props {
  folder: FolderRow | null;
}

/**
 * `⌘3` — the merge of `/api-routes`, `/relations` and `/laravel-schema` into
 * one surface with three lenses (blueprint §2.4). All three were the same
 * shape: an ECharts force graph over a parsed structure, with filter chips and
 * a metric row, ending in `navigate('/editor/…')`.
 *
 * One `Toolbar` owns the title, the shared search box, the lens chips, the
 * active lens's filter row and its `⋯`. Each lens is a hook so the toolbar can
 * read its filters and counts without a second chrome bar per lens.
 */
export default function ArchitectureView({ folder }: Props) {
  if (!folder) return <NoFolderState />;
  return <ArchitectureSurface folder={folder} />;
}

function ArchitectureSurface({ folder }: { folder: FolderRow }) {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');

  const lens = parseArchLens(params.get('lens'));

  const args = { folder, query, setQuery };
  // Hooks, so the shared Toolbar can read each lens's filters and counts. They
  // are called unconditionally and in a fixed order; only the active one loads.
  const lenses: Record<ArchLensId, ArchLens> = {
    routes: useRoutesLens({ ...args, active: lens === 'routes' }),
    imports: useImportsLens({ ...args, active: lens === 'imports' }),
    schema: useSchemaLens({ ...args, active: lens === 'schema' }),
  };
  const current = lenses[lens];

  const labels: Record<ArchLensId, string> = useMemo(() => ({
    routes: t('nav.apiRoutes'),
    imports: t('nav.relations'),
    schema: t('nav.laravelSchema'),
  }), [t]);

  const options: ToggleOption<ArchLensId>[] = ARCH_LENS_IDS.map(id => {
    const unavailable = lenses[id].available === false;
    return {
      value: id,
      // The Schema chip is never removed and is never inert: it carries the ⓘ
      // and the reason, and selecting it shows the explanation in full. The
      // primitive's `disabled` would set `pointer-events: none`, which would
      // hide the very tooltip that carries the reason.
      label: unavailable ? (
        <span className="inline-flex items-center gap-1">
          {labels[id]}
          <Info aria-hidden strokeWidth={1.75} size={11} />
        </span>
      ) : labels[id],
      icon: LENS_ICON[id],
      title: unavailable ? t('nav.laravelRequired') : undefined,
      count: lenses[id].count,
    };
  });

  // Re-layout graph · Export PNG · Copy graph data · Reset filters, plus each
  // lens's own `⋯` items and the Routes lens's eight chart variants, all one
  // keystroke away (DESIGN-SYSTEM §9 rule 1).
  const lensTitle = `${t('nav.architecture')} · ${labels[lens]}`;
  useRegisterCommands('architecture-view', () => commandsFromMenu(
    'architecture-view',
    [...(current.overflow ?? []), ...(current.commands ?? [])],
    { prefix: lensTitle },
  ));

  const selectLens = useCallback((next: ArchLensId): void => {
    const nextParams = new URLSearchParams(params);
    if (next === 'routes') nextParams.delete('lens');
    else nextParams.set('lens', next);
    setParams(nextParams);
  }, [params, setParams]);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3">
      <Toolbar
        sticky={false}
        className="rounded-lg border border-border"
        title={`${t('nav.architecture')} · ${labels[lens]}`}
        subtitle={current.subtitle}
        overflowLabel={t('common.more')}
        overflow={current.overflow}
        actions={(
          <>
            {current.searchPlaceholder ? (
              <SearchInput
                size="sm"
                data-view-search
                wrapperClassName="w-[clamp(120px,20vw,240px)]"
                aria-label={t('code.search')}
                placeholder={current.searchPlaceholder}
                value={query}
                onValueChange={setQuery}
                clearLabel={t('common.clear')}
              />
            ) : null}
            {current.actions}
          </>
        )}
        filters={(
          <>
            <ToggleGroup
              aria-label={t('code.lens')}
              variant="chips"
              value={lens}
              onValueChange={selectLens}
              options={options}
            />
            {current.filters ? (
              <>
                <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                {current.filters}
              </>
            ) : null}
          </>
        )}
      />
      {current.content}
    </div>
  );
}
