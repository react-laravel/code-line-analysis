import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Copy, FileCode2, Files, SlidersHorizontal } from 'lucide-react';
import type { DuplicateCluster } from '../../../shared/api';
import { Badge, Button, EmptyState, Panel } from '../../components/ui';
import PathCell from '../../components/PathCell';
import ScanNowButton from '../../components/ScanNowButton';
import { useI18n } from '../../i18n';
import { useAppStore, useRevision } from '../../store/app-store';
import { LensMetrics, LensMetricsText, type CodeLens, type LensArgs, type LensMetric } from './lens';

const DUPLICATE_MIN_LINES_MIN = 3;
const DUPLICATE_MIN_LINES_MAX = 200;

/**
 * Was `/duplicates`. The cluster cards stay cards — the occurrence list is a
 * nested structure a flat table cannot hold (blueprint §2.3). The threshold
 * slider moved into the toolbar `filters` row with its 550ms debounce intact,
 * the rules drawer became Settings → Scan rules `scope="duplicates"` (reachable
 * in one keystroke from the toolbar `⋯` and from `⌘K`), and the hand-rolled
 * `sessionStorage` scroll persistence (which reached for
 * `document.querySelector('.content')`) is now the shell `ScrollArea`'s
 * `restoreKey`.
 */
export function useDuplicatesLens({ folder, query, clearQuery, active }: LensArgs): CodeLens {
  const revision = useRevision();
  const { locale, t } = useI18n();
  const navigate = useNavigate();

  const [clusters, setClusters] = useState<DuplicateCluster[]>([]);
  const [minLines, setMinLines] = useState(8);
  const [minLinesDraft, setMinLinesDraft] = useState(8);

  const folderId = folder.id;
  const openRules = (): void => useAppStore.getState().openSettings('rules', 'duplicates');

  async function loadClusters(): Promise<void> {
    setClusters(await window.api.stats.duplicates(folderId));
  }

  useEffect(() => {
    setClusters([]);
  }, [folderId]);

  useEffect(() => {
    if (!active) return;
    let ignore = false;
    void window.api.stats.duplicates(folderId).then(next => {
      if (!ignore) setClusters(next);
    });
    return () => {
      ignore = true;
    };
  }, [active, folderId, revision]);

  useEffect(() => {
    if (!active) return;
    let ignore = false;
    void window.api.folders.getDuplicateMinLines(folderId).then(count => {
      if (ignore) return;
      setMinLines(count);
      setMinLinesDraft(Math.max(DUPLICATE_MIN_LINES_MIN, count));
    }).catch(() => undefined);
    return () => {
      ignore = true;
    };
    // `revision` too: Settings → Scan rules can change the threshold from the
    // duplicates scope, and Save & Rescan is what re-applies it.
  }, [active, folderId, revision]);

  // 550ms debounce, unchanged from `DuplicatesView.tsx:101-108`.
  useEffect(() => {
    if (!active || minLinesDraft === minLines) return;
    const timer = window.setTimeout(() => {
      if (!Number.isInteger(minLinesDraft) || minLinesDraft < DUPLICATE_MIN_LINES_MIN) return;
      void window.api.folders.setDuplicateMinLines(folderId, minLinesDraft).then(() => {
        setMinLines(minLinesDraft);
        return loadClusters();
      });
    }, 550);
    return () => window.clearTimeout(timer);
  }, [active, folderId, minLines, minLinesDraft]);

  const visible = useMemo(() => {
    const needle = query.toLowerCase();
    if (!needle) return clusters;
    return clusters.filter(cluster =>
      cluster.occurrences.some(occurrence => occurrence.relPath.toLowerCase().includes(needle)),
    );
  }, [clusters, query]);

  const occurrenceCount = visible.reduce((sum, cluster) => sum + cluster.occurrences.length, 0);
  const affectedFileCount = new Set(
    visible.flatMap(cluster => cluster.occurrences.map(occurrence => occurrence.relPath)),
  ).size;
  const repeatedLineCount = visible.reduce(
    (sum, cluster) => sum + (cluster.lines * cluster.occurrences.length),
    0,
  );

  const metrics: LensMetric[] = clusters.length > 0
    ? [
        { label: t('duplicates.fragments'), value: occurrenceCount.toLocaleString(locale), icon: Copy },
        { label: t('duplicates.affectedFiles'), value: affectedFileCount.toLocaleString(locale), icon: Files },
        { label: t('duplicates.repeatedLines'), value: repeatedLineCount.toLocaleString(locale), icon: FileCode2 },
      ]
    : [];

  const minLinesMax = Math.max(DUPLICATE_MIN_LINES_MAX, minLines, minLinesDraft);

  // Only the threshold stays on the primary surface; the rule editor is a
  // set-once surface and lives behind the toolbar `⋯` (DESIGN-SYSTEM §9 rule 1).
  const filters = (
    <label className="flex items-center gap-2 text-xs text-fg-muted">
      <span>{t('duplicates.minLines')}</span>
      <input
        type="range"
        min={DUPLICATE_MIN_LINES_MIN}
        max={minLinesMax}
        step={1}
        value={minLinesDraft}
        aria-label={t('duplicates.minLines')}
        onChange={event => setMinLinesDraft(Number(event.target.value))}
        className="w-[clamp(140px,18vw,240px)] accent-accent"
      />
      <output className="ds-tabular text-xs font-medium text-fg">
        {t('app.linesCount', { count: minLinesDraft.toLocaleString(locale) })}
      </output>
    </label>
  );

  const content = (
    <div className="grid gap-3">
      <LensMetrics items={metrics} />

      {visible.length === 0 ? (
        <EmptyState
          size="sm"
          variant={query ? 'no-results' : 'first-run'}
          title={query ? t('common.noResults') : t('common.noData')}
          description={query ? t('common.noResultsHelp') : t('duplicates.empty')}
          action={query
            ? <Button variant="primary" onClick={clearQuery}>{t('files.clearFilters')}</Button>
            : <ScanNowButton folderId={folderId} disabled={!folder.isAvailable} />}
          secondaryAction={<Button onClick={openRules}>{t('duplicates.rules')}</Button>}
          className="rounded-lg border border-border bg-surface"
        />
      ) : null}

      {visible.map((cluster, clusterIndex) => (
        <Panel
          key={cluster.hash}
          padded={false}
          className="overflow-hidden"
          header={(
            <span className="flex w-full min-w-0 items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-running-quiet text-running-text">
                  <Copy aria-hidden strokeWidth={1.75} size={14} />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <strong className="truncate text-xs text-fg">
                    {t('duplicates.groupLabel', { index: (clusterIndex + 1).toLocaleString(locale) })}
                  </strong>
                  <span className="truncate font-mono text-2xs text-fg-subtle" title={cluster.hash}>
                    {t('duplicates.hash')}: {cluster.hash.slice(0, 12)}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <Badge>{cluster.occurrences.length.toLocaleString(locale)} {t('duplicates.occurrences')}</Badge>
                <Badge>{cluster.lines.toLocaleString(locale)} {t('common.lines')}</Badge>
              </span>
            </span>
          )}
        >
          <div className="grid">
            {cluster.occurrences.map((occurrence, occurrenceIndex) => (
              <button
                key={`${occurrence.relPath}:${occurrence.startLine}:${occurrenceIndex}`}
                type="button"
                onClick={() => navigate(
                  `/editor/${encodeURIComponent(occurrence.relPath)}?line=${occurrence.startLine}&endLine=${occurrence.endLine}&highlight=duplicate`,
                )}
                className="grid w-full min-w-0 grid-cols-[14px_minmax(0,1fr)_auto_14px] items-center gap-2 border-b border-border px-3 py-1.5 text-left text-sm text-fg last:border-b-0 hover:bg-hover"
              >
                <FileCode2 aria-hidden strokeWidth={1.75} size={14} className="text-fg-subtle" />
                <PathCell path={occurrence.relPath} className="min-w-0" />
                <span className="text-2xs whitespace-nowrap text-fg-muted">
                  {t('duplicates.lineRange', { start: occurrence.startLine, end: occurrence.endLine })}
                </span>
                <ChevronRight aria-hidden strokeWidth={1.75} size={14} className="text-fg-muted" />
              </button>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );

  return {
    count: clusters.length > 0 ? clusters.length : undefined,
    filters,
    overflow: [
      {
        id: 'duplicate-rules',
        label: t('duplicates.rules'),
        icon: SlidersHorizontal,
        onSelect: openRules,
      },
    ],
    subtitle: (
      <>
        {t('duplicates.title', { count: minLines.toLocaleString(locale) })} <LensMetricsText items={metrics} />
      </>
    ),
    searchPlaceholder: t('duplicates.searchPlaceholder'),
    content,
  };
}
