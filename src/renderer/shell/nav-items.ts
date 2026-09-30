import { BarChart3, FileCode2, FolderTree, Share2, type LucideIcon } from 'lucide-react';
import type { TranslationKey } from '../i18n';

export interface NavItem {
  to: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
  /** `end` matching for the index route. */
  end?: boolean;
}

export interface NavGroup {
  id: string;
  labelKey: TranslationKey;
  items: NavItem[];
}

/**
 * The blueprint's target IA (§1.1): three views — Overview · Code ·
 * Architecture — each with its own lens switcher, above a permanent Explorer.
 * Eleven flat items became three.
 *
 * Setup is not here (DESIGN-SYSTEM §9 rule 2). `/folders` moved into
 * Settings → Scan rules as the `folder` scope. Workspace now also has an
 * explicit "All repositories" entry, alongside the folder menu's "Manage
 * folders…", `⌘K`, and the first-run screen, so it is easy to rediscover.
 *
 * `SideNav` hides a group heading when the group holds one item with the same
 * label, which is why this renders as a flat four-row list.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'workspace',
    labelKey: 'nav.allRepositories',
    items: [
      { to: '/', labelKey: 'nav.allRepositories', icon: FolderTree, end: true },
    ],
  },
  {
    id: 'overview',
    labelKey: 'nav.overview',
    items: [
      // Chunk 6 collapsed `/dashboard` + `/heatmap` into one view: the Git
      // activity charts are now a collapsible Panel on Overview.
      { to: '/overview', labelKey: 'nav.overview', icon: BarChart3 },
    ],
  },
  {
    id: 'code',
    labelKey: 'nav.code',
    items: [
      // Chunk 7 collapsed `/files` + `/top` + `/tags` + `/duplicates` into one
      // view with a lens switcher. The marker count that used to badge the
      // Markers nav item is now the Markers lens chip's count (§1.2).
      { to: '/code', labelKey: 'nav.code', icon: FileCode2 },
    ],
  },
  {
    id: 'architecture',
    labelKey: 'nav.architecture',
    items: [
      // Chunk 8 collapsed `/api-routes` + `/relations` + `/laravel-schema` into
      // one view with a lens switcher. The ER lens is listed inside it in every
      // folder — the nav no longer hides it when detection says "not Laravel".
      { to: '/architecture', labelKey: 'nav.architecture', icon: Share2 },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(group => group.items);
