import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TopFile } from '../../../shared/api';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Input,
  Select,
  type Column,
  type SortState,
} from '../../components/ui';
import PathCell from '../../components/PathCell';
import ScanNowButton from '../../components/ScanNowButton';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { useI18n } from '../../i18n';
import { fileExt } from '../../lib/path';
import { useRevision } from '../../store/app-store';
import { useScanStore } from '../../store/scan-store';
import { sortRows, type CodeLens, type LensArgs } from './lens';

type SortKey = 'relPath' | 'total' | 'code' | 'size' | 'lang' | 'ext' | 'lastCommitDate';

const NO_EXTENSION = '(none)';
const MAX_VISIBLE_ROWS = 1000;

interface FileRowView extends TopFile {
  ext: string;
}

/**
 * The default lens (was `/files`). Every filter, sort and threshold of
 * `FilesView.tsx` survives; the search box is now the toolbar's, shared with
 * the other three lenses.
 */
export function useFilesLens({ folder, query, clearQuery, active }: LensArgs): CodeLens {
  const revision = useRevision();
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const scanning = useScanStore(state => state.status === 'running' || state.status === 'queued');

  const [languageFilter, setLanguageFilter] = useState('ALL');
  const [extensionFilter, setExtensionFilter] = useState('ALL');
  const [minLines, setMinLines] = useState('');
  const [maxLines, setMaxLines] = useState('');
  const [sort, setSort] = useState<SortState | null>({ columnId: 'total', direction: 'desc' });

  const folderId = folder.id;
  const loadFiles = useCallback(() => window.api.stats.topFiles(folderId, 5000), [folderId]);
  const { data: files } = useAsyncResource<TopFile[]>({
    resourceKey: folderId,
    refreshToken: revision,
    enabled: active,
    initialData: [],
    load: loadFiles,
  });

  const rows = useMemo<FileRowView[]>(
    () => files.map(file => ({ ...file, ext: fileExt(file.relPath) || NO_EXTENSION })),
    [files],
  );

  const languages = useMemo(
    () => Array.from(new Set(rows.map(file => file.lang))).sort((a, b) => a.localeCompare(b, locale)),
    [locale, rows],
  );

  const extensions = useMemo(
    () => Array.from(new Set(rows.map(file => file.ext))).sort((a, b) => a.localeCompare(b, locale)),
    [locale, rows],
  );

  const filtered = useMemo(() => {
    const needle = query.toLowerCase();
    const min = minLines.trim() === '' ? null : Number(minLines);
    const max = maxLines.trim() === '' ? null : Number(maxLines);

    const matched = rows.filter(file => {
      if (
        needle
        && !file.relPath.toLowerCase().includes(needle)
        && !file.lang.toLowerCase().includes(needle)
        && !file.ext.toLowerCase().includes(needle)
      ) {
        return false;
      }
      if (languageFilter !== 'ALL' && file.lang !== languageFilter) return false;
      if (extensionFilter !== 'ALL' && file.ext !== extensionFilter) return false;
      if (min != null && !Number.isNaN(min) && file.total < min) return false;
      if (max != null && !Number.isNaN(max) && file.total > max) return false;
      return true;
    });

    return sortRows(matched, sort, locale, (file, columnId) => {
      const key = columnId as SortKey;
      return key === 'lastCommitDate' ? file.lastCommitDate ?? null : file[key];
    });
  }, [rows, query, languageFilter, extensionFilter, minLines, maxLines, sort, locale]);

  const activeFilterCount = [
    query,
    languageFilter !== 'ALL' ? languageFilter : '',
    extensionFilter !== 'ALL' ? extensionFilter : '',
    minLines,
    maxLines,
  ].filter(value => value !== '').length;

  const activeFilterLabel = activeFilterCount > 0
    ? t('files.activeFilters', { count: activeFilterCount.toLocaleString(locale) })
    : t('files.noFilters');

  const columns = useMemo<Column<FileRowView>[]>(() => [
    { id: 'relPath', header: t('common.path'), sortable: true, width: 280, cell: file => <PathCell path={file.relPath} /> },
    { id: 'lang', header: t('common.lang'), sortable: true, cell: file => <Badge size="xs">{file.lang}</Badge> },
    {
      id: 'ext',
      header: t('files.ext'),
      sortable: true,
      mono: true,
      cell: file => (file.ext === NO_EXTENSION ? t('files.noExtension') : file.ext),
    },
    { id: 'total', header: t('common.lines'), sortable: true, align: 'right', cell: file => file.total.toLocaleString(locale) },
    { id: 'code', header: t('common.code'), sortable: true, align: 'right', cell: file => file.code.toLocaleString(locale) },
    { id: 'size', header: t('common.size'), sortable: true, align: 'right', cell: file => `${(file.size / 1024).toFixed(1)} KB` },
    {
      id: 'lastCommitDate',
      header: t('files.lastCommitDate'),
      sortable: true,
      align: 'right',
      cell: file => (file.lastCommitDate
        ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(file.lastCommitDate)
        : '—'),
    },
  ], [locale, t]);

  // The search box lives in the toolbar but counts as one of the filters, so
  // "Clear filters" empties it too.
  function clearFilters(): void {
    setLanguageFilter('ALL');
    setExtensionFilter('ALL');
    setMinLines('');
    setMaxLines('');
    clearQuery();
  }

  const filters = (
    <>
      <Select
        size="sm"
        wrapperClassName="w-44"
        aria-label={t('common.lang')}
        value={languageFilter}
        onChange={event => setLanguageFilter(event.target.value)}
        options={[
          { value: 'ALL', label: t('files.allLanguages') },
          ...languages.map(lang => ({ value: lang, label: lang })),
        ]}
      />
      <Select
        size="sm"
        wrapperClassName="w-44"
        aria-label={t('files.ext')}
        value={extensionFilter}
        onChange={event => setExtensionFilter(event.target.value)}
        options={[
          { value: 'ALL', label: t('files.allExtensions') },
          ...extensions.map(ext => ({ value: ext, label: ext === NO_EXTENSION ? t('files.noExtension') : ext })),
        ]}
      />
      <Input
        size="sm"
        wrapperClassName="w-28"
        type="number"
        min={0}
        aria-label={t('files.minLines')}
        placeholder={t('files.minLines')}
        value={minLines}
        onChange={event => setMinLines(event.target.value)}
      />
      <Input
        size="sm"
        wrapperClassName="w-28"
        type="number"
        min={0}
        aria-label={t('files.maxLines')}
        placeholder={t('files.maxLines')}
        value={maxLines}
        onChange={event => setMaxLines(event.target.value)}
      />
      <Button size="sm" onClick={clearFilters} disabled={activeFilterCount === 0}>
        {t('files.clearFilters')}
      </Button>
      <Badge tone={activeFilterCount > 0 ? 'accent' : 'neutral'}>{activeFilterLabel}</Badge>
    </>
  );

  const content = (
    <>
      <DataTable
        aria-label={t('files.title')}
        columns={columns}
        rows={filtered.slice(0, MAX_VISIBLE_ROWS)}
        rowKey={file => file.relPath}
        sort={sort}
        onSortChange={setSort}
        streaming={scanning}
        onRowActivate={file => navigate(`/editor/${encodeURIComponent(file.relPath)}`)}
        empty={(
          <EmptyState
            size="sm"
            variant={activeFilterCount > 0 ? 'no-results' : 'first-run'}
            title={activeFilterCount > 0 ? t('common.noResults') : t('common.noData')}
            description={activeFilterCount > 0 ? activeFilterLabel : t('files.subtitle')}
            action={activeFilterCount > 0
              ? <Button variant="primary" onClick={clearFilters}>{t('files.clearFilters')}</Button>
              : <ScanNowButton folderId={folderId} disabled={!folder.isAvailable} />}
          />
        )}
      />
      {filtered.length > MAX_VISIBLE_ROWS ? (
        <p className="mt-2 mb-0 text-xs text-fg-muted">
          {t('files.showingFirst', { count: filtered.length.toLocaleString(locale) })}
        </p>
      ) : null}
    </>
  );

  return {
    count: rows.length > 0 ? rows.length : undefined,
    filters,
    subtitle: t('files.count', {
      shown: filtered.length.toLocaleString(locale),
      total: rows.length.toLocaleString(locale),
    }),
    searchPlaceholder: t('files.searchPlaceholder'),
    overflow: [
      {
        id: 'clear-filters',
        label: t('files.clearFilters'),
        disabled: activeFilterCount === 0,
        onSelect: clearFilters,
      },
    ],
    content,
  };
}
