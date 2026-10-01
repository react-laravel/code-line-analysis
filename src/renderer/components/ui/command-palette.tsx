// synced from mysql-compare/src/renderer/components/ui — Doge Desktop Design System
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useVirtualWindow } from '../../hooks/useVirtualWindow';
import { cn } from '../../lib/utils';
import { Kbd } from './kbd';
import { useDismiss, useFocusTrap } from './_internal/hooks';

export type CommandGroup = 'navigate' | 'action' | 'open' | 'settings';

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  /** Include the zh-CN synonyms. */
  keywords?: string;
  icon?: LucideIcon;
  /** Subtitle: the path, the connection, the tab. */
  hint?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  /** Shown instead of executing — never a dead row. */
  disabledReason?: string;
  recentAt?: number;
  perform: () => void | Promise<void>;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
  placeholder?: string;
  emptyMessage?: React.ReactNode;
  groupLabels?: Partial<Record<CommandGroup, string>>;
}

const GROUP_ORDER: CommandGroup[] = ['navigate', 'action', 'open', 'settings'];

const DEFAULT_GROUP_LABELS: Record<CommandGroup, string> = {
  navigate: 'Navigate',
  action: 'Actions',
  open: 'Open',
  settings: 'Settings',
};

/** Fuzzy token match: every whitespace-separated token must appear. */
function matches(command: Command, query: string): boolean {
  const haystack = `${command.title} ${command.keywords ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(token => haystack.includes(token));
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  placeholder = 'Type a command or search…',
  emptyMessage = 'No matching commands',
  groupLabels,
}: CommandPaletteProps) {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  useFocusTrap(ref, open);
  useDismiss(ref, { active: open, onDismiss: () => onOpenChange(false) });

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  const flat = useMemo(() => {
    const filtered = query.trim() ? commands.filter(command => matches(command, query)) : commands;
    // With no query, show recents first, then the rest in group order — never empty.
    const ordered = query.trim()
      ? filtered
      : [...filtered].sort((a, b) => (b.recentAt ?? 0) - (a.recentAt ?? 0));
    const grouped: { group: CommandGroup; items: Command[] }[] = [];
    for (const group of GROUP_ORDER) {
      const items = ordered.filter(command => command.group === group);
      if (items.length > 0) grouped.push({ group, items });
    }
    return grouped;
  }, [commands, query]);

  const rows = useMemo(() => flat.flatMap(section => section.items), [flat]);

  const entries = useMemo(() => {
    let index = 0;
    return flat.flatMap(section => [
      { group: section.group, command: null as Command | null, index: -1 },
      ...section.items.map(command => ({ group: section.group, command, index: index++ })),
    ]);
  }, [flat]);
  const virtual = useVirtualWindow(listRef, entries.length, 30, open && entries.length > 200);
  useEffect(() => {
    const viewport = listRef.current;
    if (!viewport) return;
    const entryIndex = entries.findIndex(entry => entry.index === activeIndex);
    if (entryIndex < 0) return;
    const top = entryIndex * 30;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + 30 > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = top + 30 - viewport.clientHeight;
  }, [activeIndex, entries, open]);

  if (!open) return null;

  const labels = { ...DEFAULT_GROUP_LABELS, ...groupLabels };

  async function run(command: Command): Promise<void> {
    if (command.disabled) return;
    onOpenChange(false);
    await command.perform();
  }

  return createPortal(
    <div className="fixed inset-0 z-[var(--ds-z-palette)] flex items-start justify-center p-8 pt-[12vh]">
      <div className="absolute inset-0 bg-overlay" aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative flex max-h-[60vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border-strong bg-raised shadow-overlay"
      >
        <div className="relative flex items-center border-b border-border">
          <Search aria-hidden size={14} strokeWidth={1.75} className="absolute left-3 text-fg-subtle" />
          <input
            autoFocus
            value={query}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={event => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex(index => Math.min(index + 1, rows.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex(index => Math.max(index - 1, 0));
              } else if (event.key === 'Enter' && rows[activeIndex]) {
                event.preventDefault();
                void run(rows[activeIndex]);
              }
            }}
            // The ring is never optional (DESIGN-SYSTEM §5); the offset is
            // inset because this input is flush with the dialog's edge.
            className="h-control-lg w-full bg-transparent pr-3 pl-9 text-sm text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          />
        </div>
        <div ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1">
          {rows.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-fg-muted">{emptyMessage}</div>
          ) : (
            <>
            <div aria-hidden style={{ height: virtual.before }} />
            {entries.slice(virtual.start, virtual.end).map(entry => {
              const command = entry.command;
              if (!command) return <div key={`group:${entry.group}`} className="flex h-[30px] items-center px-2 text-2xs font-medium tracking-wide text-fg-subtle uppercase">{labels[entry.group]}</div>;
              const active = entry.index === activeIndex;
              const Icon = command.icon;
              return (
                <button
                  key={command.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  aria-posinset={entry.index + 1}
                  aria-setsize={rows.length}
                  data-active={active}
                  disabled={command.disabled}
                  title={command.disabled ? command.disabledReason : undefined}
                  onMouseEnter={() => setActiveIndex(entry.index)}
                  onClick={() => void run(command)}
                  className={cn('flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg', 'disabled:opacity-50', active && 'bg-hover')}
                >
                  {Icon ? <Icon aria-hidden strokeWidth={1.75} size={14} className="shrink-0 text-fg-muted" /> : null}
                  <span className="min-w-0 flex-1 truncate">{command.title}</span>
                  {command.hint ? <span className="min-w-0 truncate text-xs text-fg-subtle">{command.hint}</span> : null}
                  {command.shortcut ? <Kbd>{command.shortcut}</Kbd> : null}
                </button>
              );
            })}
            <div aria-hidden style={{ height: virtual.after }} />
            </>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-2xs text-fg-subtle">
          <span className="flex items-center gap-1">
            <Kbd>ArrowUp</Kbd>
            <Kbd>ArrowDown</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Enter</Kbd> run
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Escape</Kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
