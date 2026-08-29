import { Command, Moon, PanelLeft, RefreshCw, Settings, Sun } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { IconButton } from '../components/ui/icon-button';
import { SplitButton } from '../components/ui/split-button';
import { Tooltip } from '../components/ui/tooltip';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { useActiveFolder, useAppStore } from '../store/app-store';
import { useScanStore } from '../store/scan-store';
import { useFolderActions } from '../hooks/useFolderActions';
import FolderSwitcher from './FolderSwitcher';

const MINUTE = 60_000;

function formatAgo(timestamp: number, locale: string): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' });
  const elapsed = Date.now() - timestamp;
  if (elapsed < MINUTE) return format.format(0, 'minute');
  if (elapsed < 60 * MINUTE) return format.format(-Math.round(elapsed / MINUTE), 'minute');
  if (elapsed < 24 * 60 * MINUTE) return format.format(-Math.round(elapsed / (60 * MINUTE)), 'hour');
  return format.format(-Math.round(elapsed / (24 * 60 * MINUTE)), 'day');
}

/**
 * 36px drag-region header (blueprint §2.1). Holds the folder context, the
 * folder path + scan freshness, and the four global controls.
 *
 * This is where Rescan finally exists: `scan.run` used to be reachable only
 * from two automatic call sites, and Cancel was the app's only scan control.
 */
export default function TitleBar() {
  const { locale, t } = useI18n();
  const { theme, setTheme } = useTheme();
  const folder = useActiveFolder();
  const sidebarCollapsed = useAppStore(state => state.sidebarCollapsed);
  const toggleSidebar = useAppStore(state => state.toggleSidebar);
  const setSettingsOpen = useAppStore(state => state.setSettingsOpen);
  const setPaletteOpen = useAppStore(state => state.setPaletteOpen);
  const status = useScanStore(state => state.status);
  const lastScanAt = useScanStore(state => (folder ? state.lastScanAt[folder.id] : undefined));
  const actions = useFolderActions();

  const scanning = status === 'running' || status === 'queued';
  const canScan = folder != null && folder.isAvailable;

  const rescan = scanning ? (
    <Button size="sm" loading onClick={actions.cancelScan}>
      {t('app.cancelScan')}
    </Button>
  ) : (
    <SplitButton
      variant="secondary"
      size="sm"
      icon={RefreshCw}
      disabled={!canScan}
      menuLabel={t('app.rescanOptions')}
      onClick={() => actions.rescan()}
      items={[
        {
          id: 'rescan-full',
          label: t('app.rescanFull'),
          onSelect: () => actions.rescan({ detectDuplicates: true }),
          disabled: !canScan,
        },
        {
          id: 'rescan-no-duplicates',
          label: t('app.rescanWithoutDuplicates'),
          onSelect: () => actions.rescan({ detectDuplicates: false }),
          disabled: !canScan,
        },
      ]}
    >
      {t('app.rescan')}
    </SplitButton>
  );

  return (
    <header className="app-drag-region flex h-titlebar shrink-0 items-center gap-2 border-b border-border bg-surface px-2">
      <IconButton
        icon={PanelLeft}
        label={sidebarCollapsed ? t('app.expandSidebar') : t('app.collapseSidebar')}
        shortcut={'Mod+\\'}
        size="sm"
        variant="ghost"
        active={!sidebarCollapsed}
        onClick={toggleSidebar}
      />
      <FolderSwitcher />
      <div className="flex min-w-0 flex-1 items-center gap-2 pl-1">
        {folder ? (
          <span className="truncate font-mono text-xs text-fg-muted" title={folder.rootPath}>
            {folder.rootPath}
          </span>
        ) : null}
        {folder ? (
          <Badge size="xs" tone={lastScanAt ? 'neutral' : 'warning'} dot className="shrink-0">
            {lastScanAt ? t('app.scannedAgo', { ago: formatAgo(lastScanAt, locale) }) : t('app.neverScanned')}
          </Badge>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canScan || scanning ? (
          rescan
        ) : (
          <Tooltip content={folder ? t('workspace.locationMissing') : t('app.selectFolder')}>
            <span>{rescan}</span>
          </Tooltip>
        )}
        <IconButton
          icon={Command}
          label={t('palette.title')}
          shortcut="Mod+K"
          size="sm"
          variant="ghost"
          onClick={() => setPaletteOpen(true)}
        />
        <IconButton
          icon={theme === 'dark' ? Sun : Moon}
          label={theme === 'dark' ? t('settings.themeLight') : t('settings.themeDark')}
          size="sm"
          variant="ghost"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        />
        <IconButton
          icon={Settings}
          label={t('app.openSettings')}
          shortcut="Mod+,"
          size="sm"
          variant="ghost"
          onClick={() => setSettingsOpen(true)}
        />
      </div>
    </header>
  );
}

/** Exported so any other surface formats scan freshness identically. */
export { formatAgo };
