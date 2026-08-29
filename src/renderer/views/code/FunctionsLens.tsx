import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Braces, Ruler } from 'lucide-react';
import type { TopFunction } from '../../../shared/api';
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  Select,
  type Column,
  type SortState,
} from '../../components/ui';
import PathCell from '../../components/PathCell';
import ScanNowButton from '../../components/ScanNowButton';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { useI18n } from '../../i18n';
import { useRevision } from '../../store/app-store';
import { useScanStore } from '../../store/scan-store';
import { LensMetrics, LensMetricsText, sortRows, type CodeLens, type LensArgs, type LensMetric } from './lens';

const LIMITS = [50, 100, 250];

type SortKey = 'relPath' | 'name' | 'startLine' | 'endLine' | 'length';

/**
 * Was `/top`. The ranking query is unchanged (`stats.topFunctions`); the limit
 * that used to be hard-coded to 50 is now a filter, and the three metric cards
 * that sat above the table became the lens chip count plus a tile strip.
 */
export function useFunctionsLens({ folder, query, clearQuery, active }: LensArgs): CodeLens {
  const revision = useRevision();
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const scanning = useScanStore(state => state.status === 'running' || state.status === 'queued');

  const [limit, setLimit] = useState(LIMITS[0]);
  const [minLength, setMinLength] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);

  const folderId = folder.id;
  const loadFunctions = useCallback(
    () => window.api.stats.topFunctions(folderId, limit),
    [folderId, limit],
  );
  const { data: funcs } = useAsyncResource<TopFunction[]>({
    resourceKey: folderId,
    refreshToken: revision,
    enabled: active,
    initialData: [],
    load: loadFunctions,
  });

  const filtered = useMemo(() => {
    const needle = query.toLowerCase();
    const min = minLength.trim() === '' ? null : Number(minLength);
    const matched = funcs.filter(fn => {
      if (needle && !fn.relPath.toLowerCase().includes(needle) && !fn.name.toLowerCase().includes(needle)) {
        return false;
      }
      if (min != null && !Number.isNaN(min) && fn.length < min) return false;
      return true;
    });
    return sortRows(matched, sort, locale, (fn, columnId) => fn[columnId as SortKey]);
  }, [funcs, locale, minLength, query, sort]);

  const columns = useMemo<Column<TopFunction>[]>(() => [
    { id: 'relPath', header: t('common.file'), sortable: true, width: 260, cell: fn => <PathCell path={fn.relPath} /> },
    { id: 'name', header: t('top.function'), sortable: true, mono: true, cell: fn => fn.name },
    { id: 'startLine', header: t('top.start'), sortable: true, align: 'right', cell: fn => fn.startLine.toLocaleString(locale) },
    { id: 'endLine', header: t('top.end'), sortable: true, align: 'right', cell: fn => fn.endLine.toLocaleString(locale) },
    { id: 'length', header: t('top.length'), sortable: true, align: 'right', cell: fn => fn.length.toLocaleString(locale) },
  ], [locale, t]);

  const longest = funcs.reduce((max, fn) => Math.max(max, fn.length), 0);
  const average = funcs.length > 0
    ? Math.round(funcs.reduce((sum, fn) => sum + fn.length, 0) / funcs.length)
    : 0;

  const metrics: LensMetric[] = funcs.length > 0
    ? [
        { label: t('top.longestFunction'), value: longest.toLocaleString(locale), icon: Ruler },
        { label: t('top.averageLength'), value: average.toLocaleString(locale), icon: Braces },
      ]
    : [];

  const filterCount = [query, minLength].filter(value => value !== '').length;

  function clearFilters(): void {
    setMinLength('');
    clearQuery();
  }

  const filters = (
    <>
      <Field label={t('top.limit')} orientation="horizontal" className="grid-cols-[auto_1fr] gap-x-2">
        <Select
          size="sm"
          wrapperClassName="w-24"
          value={String(limit)}
          onChange={event => setLimit(Number(event.target.value))}
          options={LIMITS.map(value => ({ value: String(value), label: value.toLocaleString(locale) }))}
        />
      </Field>
      <Input
        size="sm"
        wrapperClassName="w-32"
        type="number"
        min={0}
        aria-label={t('top.minLength')}
        placeholder={t('top.minLength')}
        value={minLength}
        onChange={event => setMinLength(event.target.value)}
      />
      <Button size="sm" onClick={clearFilters} disabled={filterCount === 0}>
        {t('files.clearFilters')}
      </Button>
    </>
  );

  const content = (
    <div className="grid gap-3">
      <LensMetrics items={metrics} />
      <DataTable
        aria-label={t('top.longestFunctions')}
        columns={columns}
        rows={filtered}
        rowKey={(fn, index) => `${fn.relPath}:${fn.name}:${fn.startLine}:${index}`}
        sort={sort}
        onSortChange={setSort}
        streaming={scanning}
        onRowActivate={fn => navigate(
          `/editor/${encodeURIComponent(fn.relPath)}?line=${fn.startLine}&endLine=${fn.endLine}&highlight=function`,
        )}
        empty={(
          <EmptyState
            size="sm"
            variant={filterCount > 0 ? 'no-results' : 'first-run'}
            title={filterCount > 0 ? t('common.noResults') : t('common.noData')}
            description={filterCount > 0 ? t('common.noResultsHelp') : t('top.noData')}
            action={filterCount > 0
              ? <Button variant="primary" onClick={clearFilters}>{t('files.clearFilters')}</Button>
              : <ScanNowButton folderId={folderId} disabled={!folder.isAvailable} />}
          />
        )}
      />
    </div>
  );

  return {
    count: funcs.length > 0 ? funcs.length : undefined,
    filters,
    subtitle: (
      <>
        {t('top.subtitle')} <LensMetricsText items={metrics} />
      </>
    ),
    searchPlaceholder: t('top.searchPlaceholder'),
    content,
  };
}
