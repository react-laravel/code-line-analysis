import { RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { useI18n } from '../i18n';
import { useAppStore } from '../store/app-store';
import { isFolderQueued, isFolderScanning, useScanStore } from '../store/scan-store';

interface Props {
  folderId: number;
  disabled?: boolean;
}

/**
 * The required action on every "scanned nothing yet" `EmptyState`
 * (DESIGN-SYSTEM §7.6). It runs through the shared scan store, so the progress
 * line, the status bar and Cancel all light up from here too — `scan.run` now
 * has exactly one entry point.
 */
export default function ScanNowButton({ folderId, disabled }: Props) {
  const { t } = useI18n();
  const scanning = useScanStore(state => isFolderScanning(state, folderId));
  const queued = useScanStore(state => isFolderQueued(state, folderId));
  const run = useScanStore(state => state.run);
  const detectDuplicates = useAppStore(state => state.detectDuplicatesOnScan);

  return (
    <Button
      variant="primary"
      icon={RefreshCw}
      loading={scanning}
      disabled={disabled || scanning}
      onClick={() => {
        if (!isFolderScanning(useScanStore.getState(), folderId)) void run(folderId, { detectDuplicates });
      }}
    >
      {queued ? t('app.scanQueued') : scanning ? t('app.scanStatus') : t('common.scanNow')}
    </Button>
  );
}
