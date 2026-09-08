// synced from mysql-compare/src/renderer/components/ui — Doge Desktop Design System
import { useState } from 'react';
import { ChevronDown, ChevronRight, EllipsisVertical, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { StatusDot, type StatusDotProps } from './badge';
import { IconButton } from './icon-button';
import { DropdownMenu } from './menu';
import type { MenuItem, Tone } from './_internal/types';

export interface TreeRowProps {
  depth: number;
  /** Visual indentation can differ from the accessible tree depth. */
  indentDepth?: number;
  label: React.ReactNode;
  icon?: LucideIcon;
  iconTone?: Tone;
  expandable?: boolean;
  /** Omit the toggle and its spacer for a permanently expanded root. */
  hideToggle?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  selected?: boolean;
  status?: StatusDotProps['status'];
  /** Right-aligned counts / size / age. */
  meta?: React.ReactNode;
  badges?: React.ReactNode;
  /** Revealed on hover AND focus-within — never hover-only. */
  actions?: React.ReactNode;
  /** Persistent ⋯ so the actions stay discoverable. */
  overflow?: MenuItem[];
  onActivate?: () => void;
  onContextMenu?: () => MenuItem[];
  editing?: { value: string; onCommit: (value: string) => void; onCancel: () => void };
  guides?: boolean;
  className?: string;
  overflowLabel?: string;
  title?: string;
  /**
   * Roving tab stop (DESIGN-SYSTEM §8.3): the owning `role="tree"` container
   * gives exactly one row `0` and every other row `-1`. Defaults to the
   * selection when the container does not manage focus itself.
   */
  tabIndex?: number;
}

const ICON_TONE: Record<Tone, string> = {
  neutral: 'text-fg-muted',
  accent: 'text-accent-text',
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
  running: 'text-running-text',
  idle: 'text-fg-subtle',
};

/**
 * `role="treeitem"` with `aria-level`/`aria-expanded`/`aria-selected`;
 * ← collapses or moves to parent, → expands, Enter/Space activates.
 */
export function TreeRow({
  depth,
  indentDepth = depth,
  label,
  icon: Icon,
  iconTone = 'neutral',
  expandable,
  hideToggle = false,
  expanded,
  onToggle,
  selected,
  status,
  meta,
  badges,
  actions,
  overflow,
  onActivate,
  onContextMenu,
  editing,
  guides = true,
  className,
  overflowLabel = 'Row actions',
  title,
  tabIndex,
}: TreeRowProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState(editing?.value ?? '');
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={expandable ? Boolean(expanded) : undefined}
      aria-selected={selected}
      tabIndex={tabIndex ?? (selected ? 0 : -1)}
      data-focus-inset
      title={title}
      style={{ paddingLeft: indentDepth * 12 + 8 }}
      onClick={onActivate}
      onContextMenu={event => {
        if (!onContextMenu) return;
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={event => {
        if (event.key === 'ArrowRight' && expandable && !hideToggle && !expanded) {
          event.preventDefault();
          onToggle?.();
        } else if (event.key === 'ArrowLeft' && expandable && !hideToggle && expanded) {
          event.preventDefault();
          onToggle?.();
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate?.();
        }
      }}
      className={cn(
        'group relative flex h-row-tree cursor-default items-center gap-1.5 pr-1 text-sm',
        'transition-colors duration-[120ms] hover:bg-hover',
        selected && 'bg-selected before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent',
        guides && indentDepth > 0 && 'border-l border-border/0',
        className,
      )}
    >
      {hideToggle ? null : expandable ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={event => {
            event.stopPropagation();
            onToggle?.();
          }}
          className="flex size-4 shrink-0 items-center justify-center rounded-xs text-fg-subtle hover:bg-hover hover:text-fg"
        >
          <Chevron strokeWidth={1.75} size={12} />
        </button>
      ) : (
        <span className="size-4 shrink-0" aria-hidden />
      )}
      {status ? (
        <StatusDot status={status} />
      ) : Icon ? (
        <Icon aria-hidden strokeWidth={1.75} size={12} className={cn('shrink-0', ICON_TONE[iconTone])} />
      ) : null}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onBlur={() => editing.onCommit(draft)}
          onKeyDown={event => {
            if (event.key === 'Enter') editing.onCommit(draft);
            else if (event.key === 'Escape') editing.onCancel();
          }}
          className="h-control-xs min-w-0 flex-1 rounded-sm border border-accent bg-inset px-1 text-sm text-fg"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      {badges}
      {meta ? <span className="ds-tabular shrink-0 text-xs text-fg-muted">{meta}</span> : null}
      {actions ? (
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex">
          {actions}
        </span>
      ) : null}
      {overflow && overflow.length > 0 ? (
        <DropdownMenu
          items={overflow}
          align="end"
          trigger={
            <IconButton
              icon={EllipsisVertical}
              label={overflowLabel}
              size="xs"
              variant="ghost"
              tooltip={false}
              onClick={event => event.stopPropagation()}
            />
          }
        />
      ) : null}
      {menu && onContextMenu ? (
        <DropdownMenu
          items={onContextMenu()}
          open
          onOpenChange={next => {
            if (!next) setMenu(null);
          }}
          anchorPoint={menu}
        />
      ) : null}
    </div>
  );
}
