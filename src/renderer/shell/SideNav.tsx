import { useMemo, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useRovingTabIndex } from '../components/ui/_internal/hooks';
import { Tooltip } from '../components/ui/tooltip';
import { cn } from '../lib/utils';
import { useI18n } from '../i18n';
import { NAV_GROUPS, type NavItem } from './nav-items';

interface Props {
  /** 44px icon rail — labels and group headings are hidden. */
  collapsed: boolean;
}

/**
 * Primary navigation. One tab stop for the whole list, arrows move within it
 * (DESIGN-SYSTEM §8.3).
 *
 * Nothing here is capability-gated or badged any more: the ER diagram is a lens
 * inside Architecture that explains itself when a folder is not Laravel
 * (chunk 8), and the marker count is the Markers lens chip (chunk 7). The
 * `requires` / `badge` fields and their branches went with them (chunk 12).
 */
export default function SideNav({ collapsed }: Props) {
  const { t } = useI18n();
  const location = useLocation();
  const listRef = useRef<HTMLElement>(null);

  const flat = useMemo(() => NAV_GROUPS.flatMap(group => group.items), []);
  const activeIndex = Math.max(
    0,
    flat.findIndex(item => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to))),
  );
  const roving = useRovingTabIndex(flat.length, activeIndex);

  function focusItem(index: number): void {
    const nodes = listRef.current?.querySelectorAll<HTMLElement>('[data-nav-item]');
    nodes?.[index]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    let next = -1;
    if (event.key === 'ArrowDown') next = roving.move(1);
    else if (event.key === 'ArrowUp') next = roving.move(-1);
    else if (event.key === 'Home') next = roving.move(-roving.focusIndex);
    else if (event.key === 'End') next = roving.move(flat.length - 1 - roving.focusIndex);
    if (next < 0) return;
    event.preventDefault();
    focusItem(next);
  }

  function renderItem(item: NavItem, index: number) {
    const Icon = item.icon;
    const label = t(item.labelKey);

    const body = (
      <>
        <Icon aria-hidden strokeWidth={1.75} size={14} className="shrink-0" />
        {collapsed ? null : <span className="min-w-0 flex-1 truncate">{label}</span>}
      </>
    );

    const shared = cn(
      'flex h-row-tree items-center gap-2 rounded-md px-2 text-sm text-fg no-underline',
      'transition-colors duration-[120ms]',
      collapsed && 'justify-center px-0',
    );

    const node = (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        aria-label={collapsed ? label : undefined}
        data-nav-item
        tabIndex={index === roving.focusIndex ? 0 : -1}
        onFocus={() => roving.setFocusIndex(index)}
        className={({ isActive }) =>
          cn(
            shared,
            'hover:bg-hover',
            isActive && 'bg-selected font-medium shadow-[inset_2px_0_0_var(--ds-accent)]',
          )
        }
      >
        {body}
      </NavLink>
    );

    // Collapsed to the 44px icon rail, the tooltip is the only label.
    if (!collapsed) return node;
    return (
      <Tooltip key={item.to} side="right" content={label}>
        {node}
      </Tooltip>
    );
  }

  let index = -1;
  return (
    <nav
      ref={listRef}
      aria-label={t('app.views')}
      onKeyDown={onKeyDown}
      className={cn('flex flex-col gap-3 p-2', collapsed && 'items-stretch px-1')}
    >
      {NAV_GROUPS.map(group => {
        // A group that collapsed to its own single view (all current groups,
        // after chunks 6-8) has no heading to print — it would repeat the row's
        // own label — and correspondingly no rule to draw on the 44px rail,
        // which blueprint §2.1 wants to be nav icons and nothing else.
        const selfLabelled = group.items.length === 1 && group.items[0].labelKey === group.labelKey;
        return (
        <section key={group.id} className="flex flex-col gap-0.5">
          {selfLabelled ? null : collapsed ? (
            <div aria-hidden className="mx-2 my-1 h-px bg-border" />
          ) : (
            <h2 className="px-2 py-1 text-2xs font-medium tracking-wide text-fg-subtle uppercase">
              {t(group.labelKey)}
            </h2>
          )}
          {group.items.map(item => {
            index += 1;
            return renderItem(item, index);
          })}
        </section>
        );
      })}
    </nav>
  );
}
