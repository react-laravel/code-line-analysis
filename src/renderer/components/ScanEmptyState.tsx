import { EmptyState } from './ui/empty-state';
import { useI18n } from '../i18n';
import { isFolderQueued, isFolderScanning, useScanStore } from '../store/scan-store';
import ScanNowButton from './ScanNowButton';

/** A zero-row summary/tree is not a completed set of repository statistics. */
export default function ScanEmptyState({ folderId, disabled, size }: {
  folderId: number;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const { t } = useI18n();
  const queued = useScanStore(state => isFolderQueued(state, folderId));
  const scanning = useScanStore(state => isFolderScanning(state, folderId));
  const scanned = useScanStore(state => Boolean(state.lastScanAt[folderId]));
  const state = queued ? 'queued' : scanning ? 'running' : scanned ? 'noFiles' : 'empty';

  return (
    <EmptyState
      size={size}
      title={t(`scan.${state}Title`)}
      description={t(`scan.${state}Help`)}
      action={<ScanNowButton folderId={folderId} disabled={disabled} />}
    />
  );
}
