import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TagRow } from '../../../shared/api';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ToggleGroup,
  type Column,
  type ToggleOption,
} from '../../components/ui';
import PathCell from '../../components/PathCell';
import ScanNowButton from '../../components/ScanNowButton';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { tagTone } from '../../lib/tag-tone';
import { useI18n } from '../../i18n';
import { useAppStore, useRevision } from '../../store/app-store';
import { useScanStore } from '../../store/scan-store';
import type { CodeLens, LensArgs } from './lens';

type KindFilter = '' | TagRow['kind'];

const KINDS: KindFilter[] = ['', 'TODO', 'FIXME', 'HACK', 'NOTE', 'XXX'];

const MAX_TAGS = 1000;

interface TagWithPath extends TagRow {
  relPath: string;
}

interface GroupedTagFile {
  relPath: string;
  hits: TagWithPath[];
  kinds: TagRow['kind'][];
}

function groupByFile(tags: TagWithPath[]): GroupedTagFile[] {
  const groups: GroupedTagFile[] = [];
  const byPath = new Map<string, GroupedTagFile>();

  for (const tag of tags) {
    const current = byPath.get(tag.relPath);
    if (current) {
      current.hits.push(tag);
      if (!current.kinds.includes(tag.kind)) current.kinds.push(tag.kind);
      continue;
    }
    const next: GroupedTagFile = { relPath: tag.relPath, hits: [tag], kinds: [tag.kind] };
    byPath.set(tag.relPath, next);
    groups.push(next);
  }

  return groups;
}

/**
 * Was `/tags`. The `<select>` of six kinds became a `ToggleGroup variant="chips"`
 * carrying each kind's live count, and the page's live total became the Markers
 * lens chip itself (blueprint §1.2).
 */
export function useMarkersLens({ folder, query, clearQuery, active }: LensArgs): CodeLens {
  const revision = useRevision();
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const summary = useAppStore(state => state.summary);
  const scanning = useScanStore(state => state.status === 'running' || state.status === 'queued');

  const [kind, setKind] = useState<KindFilter>('');

  const folderId = folder.id;
  const loadTags = useCallback(
    () => window.api.stats.tags(folderId, kind || undefined),
    [folderId, kind],
  );
  const { data: tags } = useAsyncResource<TagWithPath[]>({
    resourceKey: `${folderId}:${kind}`,
    refreshToken: revision,
    enabled: active,
    initialData: [],
    load: loadTags,
  });

  const groups = useMemo(() => {
    const needle = query.toLowerCase();
    const matched = needle
      ? tags.filter(tag => tag.relPath.toLowerCase().includes(needle) || tag.text.toLowerCase().includes(needle))
      : tags;
    return groupByFile(matched.slice(0, MAX_TAGS));
  }, [query, tags]);

  const shownTags = groups.reduce((sum, group) => sum + group.hits.length, 0);

  function openTag(relPath: string, lineNo: number): void {
    navigate(`/editor/${encodeURIComponent(relPath)}?line=${lineNo}`);
  }

  const columns = useMemo<Column<GroupedTagFile>[]>(() => [
    {
      id: 'kind',
      header: t('common.kind'),
      width: 140,
      cell: group => (
        <span className="flex flex-wrap gap-1">
          {group.kinds.map(currentKind => (
            <Badge key={`${group.relPath}-${currentKind}`} tone={tagTone(currentKind)}>{currentKind}</Badge>
          ))}
        </span>
      ),
    },
    {
      id: 'file',
      header: t('common.file'),
      width: 260,
      cell: group => <PathCell path={group.relPath} />,
    },
    {
      id: 'lines',
      header: t('common.lines'),
      mono: true,
      cell: group => group.hits.map(hit => hit.lineNo.toLocaleString(locale)).join(', '),
    },
    {
      id: 'jump',
      header: t('tags.jump'),
      truncate: false,
      cell: group => (
        <span className="flex flex-wrap gap-1">
          {group.hits.map((hit, index) => (
            <Button
              key={`${group.relPath}-${hit.lineNo}-${index}`}
              size="xs"
              title={t('tags.jumpToLine', { line: hit.lineNo.toLocaleString(locale) })}
              onClick={event => {
                event.stopPropagation();
                openTag(group.relPath, hit.lineNo);
              }}
            >
              {(index + 1).toLocaleString(locale)}
            </Button>
          ))}
        </span>
      ),
    },
    {
      id: 'text',
      header: t('common.text'),
      mono: true,
      cell: group => `${group.hits[0].text}${group.hits.length > 1 ? ` (+${group.hits.length - 1})` : ''}`,
    },
    {
      id: 'count',
      header: t('common.count'),
      align: 'right',
      mono: true,
      cell: group => group.hits.length.toLocaleString(locale),
    },
  ], [locale, t]);

  const markerTotal = summary
    ? Object.values(summary.tagCounts).reduce((sum, count) => sum + count, 0)
    : undefined;

  const kindOptions: ToggleOption<KindFilter>[] = KINDS.map(value => ({
    value,
    label: value || t('common.all'),
    count: value === '' ? markerTotal : summary?.tagCounts[value],
  }));

  const filterCount = [query, kind].filter(value => value !== '').length;

  function clearFilters(): void {
    setKind('');
    clearQuery();
  }

  const filters = (
    <ToggleGroup
      aria-label={t('common.kind')}
      variant="chips"
      value={kind}
      onValueChange={setKind}
      options={kindOptions}
    />
  );

  const content = (
    <DataTable
      aria-label={t('tags.title')}
      columns={columns}
      rows={groups}
      rowKey={group => group.relPath}
      streaming={scanning}
      onRowActivate={group => openTag(group.relPath, group.hits[0].lineNo)}
      empty={(
        <EmptyState
          size="sm"
          variant={filterCount > 0 ? 'no-results' : 'first-run'}
          title={filterCount > 0 ? t('common.noResults') : t('common.noData')}
          description={filterCount > 0 ? t('common.noResultsHelp') : t('tags.subtitle')}
          action={filterCount > 0
            ? <Button variant="primary" onClick={clearFilters}>{t('files.clearFilters')}</Button>
            : <ScanNowButton folderId={folderId} disabled={!folder.isAvailable} />}
        />
      )}
    />
  );

  return {
    count: markerTotal,
    filters,
    subtitle: t('tags.count', {
      tags: shownTags.toLocaleString(locale),
      files: groups.length.toLocaleString(locale),
    }),
    searchPlaceholder: t('tags.searchPlaceholder'),
    content,
  };
}
