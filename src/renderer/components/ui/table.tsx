// synced from mysql-compare/src/renderer/components/ui — Doge Desktop Design System
import { useMemo, useRef, useState } from 'react';
import { useVirtualWindow } from '../../hooks/useVirtualWindow';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { DropdownMenu } from './menu';
import { Skeleton } from './spinner';
import type { MenuItem, Tone } from './_internal/types';

export interface Column<Row> {
  id: string;
  header: React.ReactNode;
  cell: (row: Row, index: number) => React.ReactNode;
  width?: number | 'auto';
  minWidth?: number;
  align?: 'left' | 'right';
  sortable?: boolean;
  sticky?: 'left' | 'right';
  mono?: boolean;
  truncate?: boolean;
  headerTitle?: string;
}

export interface SortState {
  columnId: string;
  direction: 'asc' | 'desc';
}

export interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  variant?: 'report' | 'grid';
  density?: 'compact' | 'comfortable';
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  selection?: { selected: Set<string>; onChange: (selected: Set<string>) => void; mode: 'single' | 'multi' };
  /** Click + Enter + Space, always all three. */
  onRowActivate?: (row: Row, index: number) => void;
  onRowContextMenu?: (row: Row) => MenuItem[];
  /** Diff / status row wash. */
  rowTone?: (row: Row) => Tone | null;
  loading?: boolean;
  /** Trailing SkeletonRow + `aria-busy` on the region. */
  streaming?: boolean;
  empty?: React.ReactNode;
  stickyHeader?: boolean;
  virtual?: boolean;
  className?: string;
  'aria-label'?: string;
}

const ROW_TONE: Record<Tone, string> = {
  neutral: '',
  accent: 'bg-accent-quiet',
  success: 'bg-success-quiet',
  warning: 'bg-warning-quiet',
  danger: 'bg-danger-quiet',
  running: 'bg-running-quiet',
  idle: 'bg-idle-quiet',
};

export function Table({ className, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-sm', className)} {...rest} />;
}

export function THead({ className, ...rest }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-surface-2', className)} {...rest} />;
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function Tr({ className, ...rest }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b border-border last:border-b-0', className)} {...rest} />;
}

export interface ThProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean;
  direction?: 'asc' | 'desc' | null;
  onSort?: () => void;
  align?: 'left' | 'right';
}

/** `Th` renders its own sort affordance — no more per-page `header(k,label)` helpers. */
export function Th({ sortable, direction, onSort, align = 'left', className, children, ...rest }: ThProps) {
  const Icon = direction === 'asc' ? ChevronUp : direction === 'desc' ? ChevronDown : ChevronsUpDown;
  return (
    <th
      scope="col"
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined}
      className={cn(
        'h-row-table px-2 text-xs font-medium text-fg-muted',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
      {...rest}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          data-focus-inset
          className={cn(
            'inline-flex items-center gap-1 rounded-sm hover:text-fg',
            align === 'right' && 'flex-row-reverse',
          )}
        >
          {children}
          <Icon aria-hidden strokeWidth={1.75} size={12} className={cn(!direction && 'opacity-40')} />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export interface TdProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'right';
  mono?: boolean;
  truncate?: boolean;
}

export function Td({ align = 'left', mono, truncate = true, className, children, ...rest }: TdProps) {
  return (
    <td
      className={cn(
        'px-2 align-middle',
        align === 'right' ? 'text-right' : 'text-left',
        mono && 'font-mono text-xs',
        truncate && 'max-w-0 truncate',
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}

/** Every activatable row gets `role="row"`, `tabIndex`, `onKeyDown` and `aria-selected`. */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  variant = 'report',
  density = 'compact',
  sort,
  onSortChange,
  selection,
  onRowActivate,
  onRowContextMenu,
  rowTone,
  loading,
  streaming,
  empty,
  stickyHeader = true,
  virtual = false,
  className,
  ...rest
}: DataTableProps<Row>) {
  const [menu, setMenu] = useState<{ items: MenuItem[]; point: { x: number; y: number } } | null>(null);
  const viewport = useRef<HTMLDivElement | null>(null);
  const pixelHeight = variant === 'grid' && density !== 'comfortable' ? 26 : 30;
  const virtualWindow = useVirtualWindow(viewport, rows.length, pixelHeight, virtual);

  const rowHeight = useMemo(() => {
    if (variant === 'grid') return density === 'comfortable' ? 'h-row-grid-comfy' : 'h-row-grid';
    return 'h-row-table';
  }, [variant, density]);

  function toggleSort(columnId: string): void {
    if (!onSortChange) return;
    if (!sort || sort.columnId !== columnId) onSortChange({ columnId, direction: 'desc' });
    else if (sort.direction === 'desc') onSortChange({ columnId, direction: 'asc' });
    else onSortChange(null);
  }

  function focusRow(index: number): void {
    const node = viewport.current;
    if (!node) return;
    const top = index * pixelHeight;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (top + pixelHeight * 2 > node.scrollTop + node.clientHeight) node.scrollTop = top + pixelHeight * 2 - node.clientHeight;
    virtualWindow.refresh();
    window.requestAnimationFrame(() => node.querySelector<HTMLElement>(`[data-table-index="${index}"]`)?.focus({ preventScroll: true }));
  }

  if (!loading && rows.length === 0 && empty) {
    return <div className={cn('rounded-lg border border-border bg-surface', className)}>{empty}</div>;
  }

  return (
    <div
      ref={viewport}
      aria-busy={streaming || undefined}
      className={cn('min-w-0 overflow-x-auto rounded-lg border border-border bg-surface', virtual && 'max-h-[65vh] overflow-y-auto', className)}
    >
      <Table aria-rowcount={virtual ? rows.length + 1 : undefined} {...rest}>
        <THead className={cn(stickyHeader && 'sticky top-0 z-[var(--ds-z-sticky)]')}>
          <Tr>
            {columns.map(column => (
              <Th
                key={column.id}
                align={column.align}
                sortable={column.sortable}
                title={column.headerTitle}
                direction={sort?.columnId === column.id ? sort.direction : null}
                onSort={() => toggleSort(column.id)}
                style={column.width && column.width !== 'auto' ? { width: column.width } : undefined}
              >
                {column.header}
              </Th>
            ))}
          </Tr>
        </THead>
        <TBody>
          {virtual && virtualWindow.before > 0 ? <tr aria-hidden><td colSpan={columns.length} style={{ height: virtualWindow.before, padding: 0, border: 0 }} /></tr> : null}
          {loading ? (
            <Tr>
              <Td colSpan={columns.length} truncate={false} className="p-2">
                <Skeleton variant="row" count={6} />
              </Td>
            </Tr>
          ) : (
            rows.slice(virtualWindow.start, virtualWindow.end).map((row, visibleIndex) => {
              const index = visibleIndex + virtualWindow.start;
              const key = rowKey(row, index);
              const selected = selection?.selected.has(key) ?? false;
              const tone = rowTone?.(row) ?? null;
              const activatable = Boolean(onRowActivate);
              return (
                <Tr
                  key={key}
                  aria-rowindex={virtual ? index + 2 : undefined}
                  data-table-index={index}
                  aria-selected={selection ? selected : undefined}
                  tabIndex={activatable ? 0 : undefined}
                  data-focus-inset={activatable ? '' : undefined}
                  onClick={() => {
                    if (selection) {
                      const next = new Set(selection.mode === 'single' ? [] : selection.selected);
                      if (selected) next.delete(key);
                      else next.add(key);
                      selection.onChange(next);
                    }
                    onRowActivate?.(row, index);
                  }}
                  onKeyDown={event => {
                    if (!activatable) return;
                    if (virtual && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                      event.preventDefault();
                      focusRow(event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
                      return;
                    }
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onRowActivate?.(row, index);
                    }
                  }}
                  onContextMenu={event => {
                    if (!onRowContextMenu) return;
                    event.preventDefault();
                    setMenu({ items: onRowContextMenu(row), point: { x: event.clientX, y: event.clientY } });
                  }}
                  className={cn(
                    rowHeight,
                    tone && ROW_TONE[tone],
                    activatable && 'cursor-pointer',
                    'hover:bg-hover',
                    selected && 'bg-selected',
                  )}
                >
                  {columns.map(column => (
                    <Td
                      key={column.id}
                      align={column.align}
                      mono={column.mono}
                      truncate={column.truncate !== false}
                    >
                      {column.cell(row, index)}
                    </Td>
                  ))}
                </Tr>
              );
            })
          )}
          {virtual && virtualWindow.after > 0 ? <tr aria-hidden><td colSpan={columns.length} style={{ height: virtualWindow.after, padding: 0, border: 0 }} /></tr> : null}
          {streaming ? (
            <Tr>
              <Td colSpan={columns.length} truncate={false} className="p-2">
                <Skeleton variant="row" count={1} delayMs={0} />
              </Td>
            </Tr>
          ) : null}
        </TBody>
      </Table>
      {menu ? (
        <DropdownMenu
          items={menu.items}
          open
          onOpenChange={next => {
            if (!next) setMenu(null);
          }}
          anchorPoint={menu.point}
        />
      ) : null}
    </div>
  );
}
