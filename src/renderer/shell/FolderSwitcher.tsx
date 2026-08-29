import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { EllipsisVertical, FolderPlus, FolderTree, GitBranch, Settings2 } from 'lucide-react';
import type { FolderRow } from '../../shared/api';
import type { MenuItem } from '../components/ui/_internal/types';
import { Badge, StatusDot } from '../components/ui/badge';
import { Combobox } from '../components/ui/combobox';
import { IconButton } from '../components/ui/icon-button';
import { DropdownMenu } from '../components/ui/menu';
import { commitAgeTone, daysSinceCommit } from '../lib/commit-age';
import { useI18n } from '../i18n';
import { useAppStore } from '../store/app-store';
import { useFolderActions } from '../hooks/useFolderActions';

/**
 * Replaces the overloaded workspace card (`App.tsx:416-445`) — a `NavLink` with
 * a transparent `<select>` stacked on its chevron — with two labeled controls:
 * a searchable `Combobox` for switching context, and a separate menu for the
 * folder-management verbs.
 *
 * Deviation from blueprint §1.1: the shared `Combobox` has no footer slot, and
 * inventing one would contradict PRIMITIVES §4. The three footer items
 * (Add folder… / Add Git repositories… / Manage folders…) therefore live in the
 * adjacent `DropdownMenu` instead of inside the popover.
 */
export default function FolderSwitcher() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const folders = useAppStore(state => state.folders);
  const activeFolderId = useAppStore(state => state.activeFolderId);
  const setActiveFolderId = useAppStore(state => state.setActiveFolderId);
  const repoInfoByFolder = useAppStore(state => state.repoInfoByFolder);
  const loadRepoInfo = useAppStore(state => state.loadRepoInfo);
  const actions = useFolderActions();

  const active = folders.find(folder => folder.id === activeFolderId) ?? null;

  // Each item carries its last-commit age (blueprint §3.3). The switcher is
  // always mounted, so it is what warms the shared cache the Workspace table
  // reads; entries already present are never refetched.
  useEffect(() => {
    void loadRepoInfo();
  }, [folders, loadRepoInfo]);

  function commitBadge(folder: FolderRow) {
    const days = daysSinceCommit(repoInfoByFolder[folder.id]?.lastCommitDate);
    if (days === null) return null;
    const label = days === 0 ? t('workspace.daysAgo_one', { count: 0 }) : t('workspace.daysAgo', { count: days });
    return <Badge size="xs" dot tone={commitAgeTone(days)}>{label}</Badge>;
  }

  const menuItems: MenuItem[] = [
    {
      id: 'add-folder',
      label: t('app.addFolder'),
      icon: FolderPlus,
      shortcut: 'Mod+O',
      onSelect: () => void actions.addFolder(),
    },
    {
      id: 'add-git-repositories',
      label: t('workspace.addGitRepositories'),
      icon: GitBranch,
      onSelect: () => void actions.addGitRepositories(),
    },
    { kind: 'separator', id: 'sep' },
    {
      id: 'manage-folders',
      label: t('app.manageFolders'),
      icon: FolderTree,
      onSelect: () => navigate('/'),
    },
    {
      // `/folders` is gone: the per-folder rules are the `folder` scope of the
      // one RuleEditor, in Settings (DESIGN-SYSTEM §9 rules 2 and 3).
      id: 'scan-rules',
      label: t('nav.folderManager'),
      icon: Settings2,
      disabled: active == null,
      onSelect: () => useAppStore.getState().openSettings('rules', 'folder'),
    },
  ];

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Combobox<FolderRow>
        items={folders}
        value={active}
        onValueChange={folder => {
          if (folder) setActiveFolderId(folder.id);
        }}
        itemKey={folder => folder.name}
        groupBy={folder => (folder.isAvailable ? t('app.foldersAvailable') : t('app.foldersMissing'))}
        filter={(folder, query) => {
          const needle = query.trim().toLowerCase();
          return (
            folder.name.toLowerCase().includes(needle) ||
            folder.rootPath.toLowerCase().includes(needle)
          );
        }}
        size="sm"
        className="max-w-64 min-w-40"
        placeholder={t('app.selectFolder')}
        searchPlaceholder={t('app.searchFolders')}
        emptyMessage={t('workspace.emptyTitle')}
        aria-label={t('app.selectedFolder')}
        renderValue={folder => (
          <span className="flex min-w-0 items-center gap-1.5">
            <StatusDot status={folder.isAvailable ? 'success' : 'danger'} />
            <span className="min-w-0 truncate">{folder.name}</span>
          </span>
        )}
        renderItem={folder => (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <StatusDot status={folder.isAvailable ? 'success' : 'danger'} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{folder.name}</span>
              <span className="truncate font-mono text-2xs text-fg-subtle">{folder.rootPath}</span>
            </span>
            {folder.isAvailable
              ? commitBadge(folder)
              : <Badge size="xs" tone="danger">{t('workspace.missingShort')}</Badge>}
          </span>
        )}
      />
      {active && !active.isAvailable ? (
        <Badge tone="danger" size="xs">{t('workspace.missingShort')}</Badge>
      ) : null}
      <DropdownMenu
        items={menuItems}
        align="start"
        trigger={
          <IconButton icon={EllipsisVertical} label={t('app.folderActions')} size="sm" variant="ghost" />
        }
      />
    </div>
  );
}
