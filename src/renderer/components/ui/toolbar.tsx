// synced from mysql-compare/src/renderer/components/ui — Doge Desktop Design System
import { EllipsisVertical, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { IconButton } from './icon-button';
import { DropdownMenu } from './menu';
import { ProgressBar } from './progress';
import type { MenuItem, ProgressState } from './_internal/types';

export interface ToolbarProps {
  title?: React.ReactNode;
  /** Path, row count, connection — mono where it is a literal. */
  subtitle?: React.ReactNode;
  icon?: LucideIcon;
  /** High-frequency only; cap at ~4 controls. */
  actions?: React.ReactNode;
  /** Everything else -> a single trailing ⋯. */
  overflow?: MenuItem[];
  /** Second row; wraps as a ToggleGroup chips row. */
  filters?: React.ReactNode;
  /** Renders a 2px ProgressBar on the bottom edge — zero layout cost. */
  progress?: ProgressState | null;
  sticky?: boolean;
  className?: string;
  overflowLabel?: string;
}

/**
 * The anchor of the whole IA: `title` ALWAYS renders (the old `PageHeader`
 * returned `null` unless `meta`/`actions` was passed, so no screen had a title).
 */
export function Toolbar({
  title,
  subtitle,
  icon: Icon,
  actions,
  overflow,
  filters,
  progress,
  sticky = true,
  className,
  overflowLabel = 'More actions',
}: ToolbarProps) {
  return (
    <div
      className={cn(
        'relative min-w-0 shrink-0 border-b border-border bg-surface',
        sticky && 'sticky top-0 z-[var(--ds-z-chrome)]',
        className,
      )}
    >
      <div className="flex min-h-toolbar flex-wrap items-center gap-x-4 gap-y-3 px-3 py-3">
        {Icon ? <Icon size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-fg-muted" /> : null}
        <div className="grid min-w-0 flex-1 basis-44 gap-1">
          {title ? <h1 className="m-0 truncate text-lg font-semibold text-fg">{title}</h1> : null}
          {subtitle ? <div className="text-xs leading-relaxed text-fg-muted">{subtitle}</div> : null}
        </div>
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
          {actions}
          {overflow && overflow.length > 0 ? (
            <DropdownMenu
              items={overflow}
              align="end"
              trigger={
                <IconButton icon={EllipsisVertical} label={overflowLabel} size="sm" variant="ghost" />
              }
            />
          ) : null}
        </div>
      </div>
      {filters ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-surface-2/60 px-3 py-2">{filters}</div>
      ) : null}
      {progress ? (
        <ProgressBar {...progress} variant="line" className="absolute inset-x-0 bottom-0" />
      ) : null}
    </div>
  );
}
