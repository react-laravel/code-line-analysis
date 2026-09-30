import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Braces, Copy, Files, Tags } from 'lucide-react';
import type { FolderRow } from '../../shared/api';
import { SearchInput, ToggleGroup, Toolbar, type ToggleOption } from '../components/ui';
import NoFolderState from '../components/NoFolderState';
import { commandsFromMenu, useRegisterCommands } from '../hooks/useCommands';
import { useI18n } from '../i18n';
import { useAppStore } from '../store/app-store';
import { useFilesLens } from './code/FilesLens';
import { useFunctionsLens } from './code/FunctionsLens';
import { useMarkersLens } from './code/MarkersLens';
import { useDuplicatesLens } from './code/DuplicatesLens';
import { LENS_IDS, parseLens, type CodeLens, type LensId } from './code/lens';

const LENS_ICON = {
  files: Files,
  functions: Braces,
  markers: Tags,
  duplicates: Copy,
} as const;

interface Props {
  folder: FolderRow | null;
}

/**
 * `⌘2` — the merge of `/files`, `/top`, `/tags` and `/duplicates` into one
 * surface with four lenses (blueprint §2.3). The four pages were the same
 * shape: a ranked list of file locations with a couple of metric cards on top,
 * every one of them ending in `navigate('/editor/…')`.
 *
 * One `Toolbar` owns the title, the shared search box, the lens chips with
 * their live counts, the active lens's filter row and its `⋯`. The lens itself
 * is a hook so the toolbar can read its filters and counts without a second
 * chrome bar per lens.
 */
export default function CodeView({ folder }: Props) {
  if (!folder) return <NoFolderState />;
  return <CodeSurface folder={folder} />;
}

function CodeSurface({ folder }: { folder: FolderRow }) {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const summary = useAppStore(state => state.summary);

  const lens = parseLens(params.get('lens'));
  const clearQuery = useCallback(() => setQuery(''), []);

  const args = { folder, query, clearQuery };
  // Hooks, so the shared Toolbar can read each lens's filters and counts. They
  // are called unconditionally and in a fixed order; only the active one loads.
  const lenses: Record<LensId, CodeLens> = {
    files: useFilesLens({ ...args, active: lens === 'files' }),
    functions: useFunctionsLens({ ...args, active: lens === 'functions' }),
    markers: useMarkersLens({ ...args, active: lens === 'markers' }),
    duplicates: useDuplicatesLens({ ...args, active: lens === 'duplicates' }),
  };
  const current = lenses[lens];

  const labels: Record<LensId, string> = useMemo(() => ({
    files: t('nav.files'),
    functions: t('nav.top'),
    markers: t('nav.tags'),
    duplicates: t('nav.duplicates'),
  }), [t]);

  const options: ToggleOption<LensId>[] = LENS_IDS.map(id => ({
    value: id,
    label: labels[id],
    icon: LENS_ICON[id],
    // Files is capped at 5,000 rows by the query, so its chip prefers the
    // folder summary's true total.
    count: id === 'files' ? summary?.totalFiles ?? lenses.files.count : lenses[id].count,
  }));

  // The active lens's `⋯` is its list of demoted actions, so it is exactly
  // what `⌘K` has to carry too (DESIGN-SYSTEM §9 rule 1) — "Clear filters" on
  // Files, "Duplicate Code Allow / Block List" on Duplicates, and so on.
  const lensTitle = `${t('nav.code')} · ${labels[lens]}`;
  useRegisterCommands('code-view', () => [
    ...commandsFromMenu('code-view', current.overflow ?? [], { prefix: lensTitle }),
    {
      id: 'code-view:clear-search',
      group: 'action' as const,
      title: `${lensTitle} · ${t('common.clear')}`,
      disabled: query.length === 0,
      perform: clearQuery,
    },
  ]);

  function selectLens(next: LensId): void {
    const nextParams = new URLSearchParams(params);
    if (next === 'files') nextParams.delete('lens');
    else nextParams.set('lens', next);
    setParams(nextParams);
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <Toolbar
        sticky={false}
        className="rounded-lg border border-border"
        title={`${t('nav.code')} · ${labels[lens]}`}
        subtitle={current.subtitle}
        overflowLabel={t('common.more')}
        overflow={current.overflow}
        actions={(
          <SearchInput
            size="sm"
            data-view-search
            wrapperClassName="w-[clamp(180px,24vw,320px)] max-w-full"
            aria-label={t('code.search')}
            placeholder={current.searchPlaceholder ?? t('code.searchPlaceholder')}
            value={query}
            onValueChange={setQuery}
            clearLabel={t('common.clear')}
          />
        )}
        filters={(
          <>
            <ToggleGroup
              aria-label={t('code.lens')}
              variant="segmented"
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
