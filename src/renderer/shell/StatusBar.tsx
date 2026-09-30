import { Square } from 'lucide-react';
import { StatusDot } from '../components/ui/badge';
import type { StatusTone } from '../components/ui/_internal/types';
import { IconButton } from '../components/ui/icon-button';
import { useI18n } from '../i18n';
import { useAppStore } from '../store/app-store';
import { useScanStore } from '../store/scan-store';

const STATUS_TONE: Record<string, StatusTone> = {
  idle: 'idle',
  queued: 'idle',
  running: 'running',
  done: 'success',
  error: 'danger',
  cancelled: 'idle',
};

/**
 * Tier 3 of DESIGN-SYSTEM §7.2 — a persistent 24px bar for global background
 * work. Together with the 2px line above the content region this replaces the
 * `scan-panel` that used to appear and disappear inside the sidebar, pushing
 * the nav list up and down (`App.tsx:486-509`).
 *
 * The old panel's `aria-live="polite"` region is preserved here verbatim in
 * intent: one polite region that announces phase, progress and cache hits.
 */
export default function StatusBar() {
  const { locale, t } = useI18n();
  const summary = useAppStore(state => state.summary);
  const status = useScanStore(state => state.status);
  const scanFolderId = useScanStore(state => state.folderId);
  const scanFolder = useAppStore(state => state.folders.find(folder => folder.id === scanFolderId));
  const progress = useScanStore(state => state.progress);
  const durationMs = useScanStore(state => state.durationMs);
  const filesScanned = useScanStore(state => state.filesScanned);
  const cancel = useScanStore(state => state.cancel);

  const scanning = status === 'running' || status === 'queued';
  const phaseLabel = progress
    ? {
        walking: t('progress.walking'),
        parsing: t('progress.parsing'),
        persisting: t('progress.persisting'),
        done: t('progress.done'),
      }[progress.phase]
    : null;

  let label: string;
  if (scanning) {
    label = phaseLabel ?? t('app.scanStatus');
  } else if (status === 'done') {
    label = t('app.scanFinished', {
      files: (filesScanned ?? 0).toLocaleString(locale),
      seconds: ((durationMs ?? 0) / 1000).toFixed(1),
    });
  } else if (status === 'error') {
    label = t('app.scanFailed');
  } else if (status === 'cancelled') {
    label = t('app.scanCancelled');
  } else {
    label = t('app.statusIdle');
  }

  return (
    <footer className="flex h-statusbar shrink-0 items-center gap-3 border-t border-border bg-surface px-2 text-xs text-fg-muted">
      <div className="flex min-w-0 flex-1 items-center gap-2" aria-live="polite">
        <StatusDot status={STATUS_TONE[status] ?? 'idle'} label={scanning && scanFolder ? `${scanFolder.name} · ${label}` : label} />
        {scanning && progress ? (
          <span className="ds-tabular shrink-0">
            {progress.done.toLocaleString(locale)}/{progress.total.toLocaleString(locale)}
          </span>
        ) : null}
        {scanning && progress?.current ? (
          <span className="min-w-0 truncate font-mono text-2xs text-fg-subtle">{progress.current}</span>
        ) : null}
        {scanning && progress?.cacheHits != null ? (
          <span className="shrink-0 text-2xs text-fg-subtle">
            {t('app.cacheHits', { count: progress.cacheHits })}
          </span>
        ) : null}
        {scanning ? (
          <IconButton
            icon={Square}
            label={t('app.cancelScan')}
            shortcut="Mod+."
            size="xs"
            variant="danger-ghost"
            onClick={cancel}
          />
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {summary ? (
          <span className="ds-tabular">
            {t('files.countShort', { count: summary.totalFiles.toLocaleString(locale) })}
          </span>
        ) : null}
        {summary ? (
          <span className="ds-tabular">
            {t('app.linesCount', { count: summary.totalLines.toLocaleString(locale) })}
          </span>
        ) : null}
        <span className="text-fg-subtle">v{__APP_VERSION__}</span>
      </div>
    </footer>
  );
}
