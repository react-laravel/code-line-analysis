import { create } from 'zustand';
import type { ScanOptions, ScanProgress } from '../../shared/api';
import type { JobStatus } from '../components/ui';
import { useAppStore } from './app-store';
import { readPersisted, writePersisted } from './persist';

export interface ScanState {
  status: JobStatus;
  folderId: number | null;
  progress: ScanProgress | null;
  error: string | null;
  outcomeToken: number;
  lastScanAt: Record<number, number>;
  durationMs: number | null;
  filesScanned: number | null;
  /** Every submitted manual job remains visible until its command settles. */
  queuedFolderIds: number[];
  listen: () => () => void;
  run: (folderId: number, opts?: ScanOptions) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

const LAST_SCAN_KEY = 'last-scan-at';
interface PendingJob { folderId: number; startedAt: number; refreshed: boolean }
const pendingJobs = new Map<string, PendingJob>();
let cancelRequested = false;
let doneTimer: number | null = null;

function clearDoneTimer(): void {
  if (doneTimer !== null) {
    window.clearTimeout(doneTimer);
    doneTimer = null;
  }
}

function pendingFolders(): number[] {
  return Array.from(pendingJobs.values(), job => job.folderId);
}

export const useScanStore = create<ScanState>((set, get) => {
  function recordSuccess(folderId: number): void {
    const lastScanAt = { ...get().lastScanAt, [folderId]: Date.now() };
    writePersisted(LAST_SCAN_KEY, lastScanAt);
    set({ lastScanAt });
    useAppStore.getState().bumpRevision();
  }

  return {
    status: 'idle', folderId: null, progress: null, error: null,
    outcomeToken: 0, lastScanAt: readPersisted<Record<number, number>>(LAST_SCAN_KEY, {}),
    durationMs: null, filesScanned: null, queuedFolderIds: [],

    listen() {
      return window.api.scan.onProgress(progress => {
        const job = progress.requestId ? pendingJobs.get(progress.requestId) : undefined;
        if (progress.phase === 'done') {
          // Terminal outcome is explicit, including an empty successful repository.
          // Legacy runtimes cannot prove success from a zero-file terminal event.
          const successful = progress.outcome === 'success'
            || (!progress.outcome && !job && !cancelRequested && progress.total > 0);
          if (successful) {
            recordSuccess(progress.folderId);
            if (job) job.refreshed = true;
          }
          if (job) {
            set({ progress });
            return; // Its command promise owns its terminal UI transition.
          }
          clearDoneTimer();
          const cancelled = progress.outcome === 'cancelled' || (!progress.outcome && cancelRequested);
          cancelRequested = false;
          const queued = pendingFolders();
          set(state => ({
            status: queued.length > 0 ? 'queued' : cancelled ? 'cancelled' : progress.outcome === 'error' ? 'error' : 'idle',
            folderId: queued[0] ?? progress.folderId, progress: null, error: null,
            durationMs: null, filesScanned: null,
            outcomeToken: state.outcomeToken + (cancelled || progress.outcome === 'error' ? 1 : 0),
          }));
          return;
        }
        clearDoneTimer();
        cancelRequested = false;
        if (job && job.startedAt === 0) job.startedAt = Date.now();
        set({ progress, folderId: progress.folderId, status: 'running' });
      });
    },

    async run(folderId, opts) {
      // The backend serializes all jobs. Submit every request immediately so a
      // bulk import is fully queued even while another repository is scanning.
      const id = crypto.randomUUID();
      const job: PendingJob = { folderId, startedAt: 0, refreshed: false };
      pendingJobs.set(id, job);
      clearDoneTimer();
      const alreadyRunning = get().status === 'running';
      set({
        queuedFolderIds: pendingFolders(),
        ...(alreadyRunning ? {} : { status: 'queued', folderId: pendingFolders()[0], progress: null, error: null, durationMs: null, filesScanned: null }),
      });
      try {
        const stats = await window.api.scan.run(folderId, { ...opts, requestId: id });
        // A cancellation may race with a successful commit. A successful reply
        // always represents committed data and must refresh the renderer.
        if (!job.refreshed) recordSuccess(folderId);
        pendingJobs.delete(id);
        const queued = pendingFolders();
        const otherRunning = get().status === 'running' && get().progress?.requestId !== id;
        set(state => ({
          queuedFolderIds: queued, outcomeToken: state.outcomeToken + 1,
          ...(otherRunning ? {} : {
            status: queued.length > 0 ? 'queued' : 'done', folderId: queued[0] ?? folderId,
            progress: null, error: null, durationMs: job.startedAt ? Date.now() - job.startedAt : null, filesScanned: stats.totalFiles,
          }),
        }));
        if (!otherRunning && queued.length === 0) {
          doneTimer = window.setTimeout(() => {
            doneTimer = null;
            if (get().status === 'done') set({ status: 'idle', progress: null });
          }, 1200);
        }
      } catch (error) {
        pendingJobs.delete(id);
        const message = error instanceof Error ? error.message : String(error ?? '');
        const cancelled = /scan cancelled/i.test(message);
        const queued = pendingFolders();
        const otherRunning = get().status === 'running' && get().progress?.requestId !== id;
        set(state => ({
          queuedFolderIds: queued, outcomeToken: state.outcomeToken + 1,
          ...(otherRunning ? {} : {
            status: queued.length > 0 ? 'queued' : cancelled ? 'cancelled' : 'error',
            folderId: queued[0] ?? folderId, progress: null, error: cancelled ? null : message,
          }),
        }));
      } finally {
        cancelRequested = false;
      }
    },

    cancel() {
      const { status } = get();
      if (status !== 'running' && status !== 'queued') return;
      cancelRequested = true;
      void window.api.scan.cancel().catch(() => undefined);
    },

    reset() {
      clearDoneTimer();
      set({ status: 'idle', progress: null, error: null });
    },
  };
});

export function useIsScanning(): boolean {
  return useScanStore(state => state.status === 'running' || state.status === 'queued');
}

export function isFolderScanning(
  state: Pick<ScanState, 'status' | 'folderId'>,
  folderId: number | null | undefined,
): boolean {
  return folderId != null && state.folderId === folderId
    && (state.status === 'running' || state.status === 'queued');
}
