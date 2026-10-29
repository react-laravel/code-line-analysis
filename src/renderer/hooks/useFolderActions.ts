import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FolderRow } from '../../shared/api';
import { toast } from '../components/ui/toast';
import { useI18n } from '../i18n';
import { useAppStore } from '../store/app-store';
import { isFolderScanning, useScanStore } from '../store/scan-store';
import { useTabsStore } from '../store/tabs-store';

export interface FolderActions {
  addFolder: () => Promise<void>;
  addGitRepositories: () => Promise<void>;
  openFolder: (folderId: number) => void;
  /** Opens the ConfirmDialog the shell renders — never `window.confirm`. */
  requestRemoveFolder: (folder: FolderRow) => void;
  removeFolder: (folder: FolderRow) => Promise<void>;
  relocateFolder: (folder: FolderRow) => Promise<void>;
  rescan: (options?: { detectDuplicates?: boolean }) => void;
  cancelScan: () => void;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

/**
 * Every folder mutation in one place, with the five `alert()` calls and the one
 * `confirm()` from `App.tsx` replaced by `Toast` / `ConfirmDialog`
 * (DESIGN-SYSTEM §7.5).
 */
export function useFolderActions(): FolderActions {
  const { t } = useI18n();
  const navigate = useNavigate();

  const scanNewFolder = useCallback((folderId: number) => {
    void useScanStore.getState().run(folderId, {
      detectDuplicates: useAppStore.getState().detectDuplicatesOnScan,
    });
  }, []);

  const addFolder = useCallback(async () => {
    const token = await window.api.folders.pickDirectory();
    if (!token) return;

    const folder = await window.api.folders.add(token);
    await useAppStore.getState().refreshFolders();
    useAppStore.getState().setActiveFolderId(folder.id);
    navigate('/overview');
    scanNewFolder(folder.id);
  }, [navigate, scanNewFolder]);

  const addGitRepositories = useCallback(async () => {
    const token = await window.api.folders.pickDirectory();
    if (!token) return;

    let addedFolders: FolderRow[];
    try {
      if (typeof window.api.folders.addGitRepositories !== 'function') {
        toast.show({ tone: 'warning', title: t('workspace.addGitRepositoriesRestartRequired') });
        return;
      }

      addedFolders = await window.api.folders.addGitRepositories(token);
      if (addedFolders.length === 0) {
        toast.show({ tone: 'warning', title: t('workspace.noGitRepositoriesFound') });
        return;
      }
    } catch (error) {
      console.error('Add Git repositories failed:', error);
      const message = detail(error);
      if (message.includes('No handler registered') || message.includes('folders:addGitRepositories')) {
        toast.show({ tone: 'warning', title: t('workspace.addGitRepositoriesRestartRequired') });
        return;
      }
      toast.show({
        tone: 'danger',
        title: t('workspace.addGitRepositoriesFailed', { detail: message || '-' }),
        details: message || undefined,
      });
      return;
    }

    await useAppStore.getState().refreshFolders();
    const first = addedFolders[0];
    // A bulk import from the cold-start screen has no folder to keep, so adopt
    // the first repository — otherwise `/overview` renders the "no folder
    // selected" dead-end straight after a successful import. With a folder
    // already open we leave the context alone and let the toast's "Open first"
    // action switch it (blueprint §2.6).
    if (useAppStore.getState().activeFolderId == null) {
      useAppStore.getState().setActiveFolderId(first.id);
    }
    navigate('/overview');
    for (const folder of addedFolders) scanNewFolder(folder.id);
    toast.show({
      tone: 'success',
      title: t('workspace.gitRepositoriesAdded', { count: addedFolders.length }),
      action: {
        label: t('workspace.openFirstAdded', { name: first.name }),
        onClick: () => useAppStore.getState().setActiveFolderId(first.id),
      },
    });
  }, [navigate, scanNewFolder, t]);

  const openFolder = useCallback((folderId: number) => {
    useAppStore.getState().setActiveFolderId(folderId);
    navigate('/overview');
  }, [navigate]);

  const requestRemoveFolder = useCallback((folder: FolderRow) => {
    useAppStore.getState().setPendingRemoveFolder(folder);
  }, []);

  const removeFolder = useCallback(async (folder: FolderRow) => {
    await window.api.folders.remove(folder.id);
    useTabsStore.getState().dropFolder(folder.id);
    await useAppStore.getState().refreshFolders();
    toast.show({ tone: 'success', title: t('workspace.folderRemoved', { name: folder.name }) });
  }, [t]);

  const relocateFolder = useCallback(async (folder: FolderRow) => {
    const rootPath = await window.api.folders.pickDirectory();
    if (!rootPath) return;

    try {
      const relocated = await window.api.folders.relocate(folder.id, rootPath);
      await useAppStore.getState().refreshFolders();
      useAppStore.getState().setActiveFolderId(relocated.id);
      scanNewFolder(relocated.id);
    } catch (error) {
      const message = detail(error);
      toast.show({
        tone: 'danger',
        title: t('workspace.relocateFailed', { detail: message || '-' }),
        details: message || undefined,
      });
    }
  }, [scanNewFolder, t]);

  const rescan = useCallback((options?: { detectDuplicates?: boolean }) => {
    const { activeFolderId, folders, detectDuplicatesOnScan } = useAppStore.getState();
    if (activeFolderId == null) return;
    if (!folders.find(folder => folder.id === activeFolderId)?.isAvailable) return;
    if (isFolderScanning(useScanStore.getState(), activeFolderId)) return;
    void useScanStore.getState().run(activeFolderId, {
      detectDuplicates: options?.detectDuplicates ?? detectDuplicatesOnScan,
    });
  }, []);

  const cancelScan = useCallback(() => {
    useScanStore.getState().cancel();
  }, []);

  return useMemo(() => ({
    addFolder,
    addGitRepositories,
    openFolder,
    requestRemoveFolder,
    removeFolder,
    relocateFolder,
    rescan,
    cancelScan,
  }), [
    addFolder,
    addGitRepositories,
    openFolder,
    requestRemoveFolder,
    removeFolder,
    relocateFolder,
    rescan,
    cancelScan,
  ]);
}
