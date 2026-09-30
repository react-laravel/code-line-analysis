import type { LucideIcon } from 'lucide-react';
import type { FolderRow } from '../../../shared/api';
import { StatTile, type MenuItem, type SortState } from '../../components/ui';

/** The four lenses of the Code view (blueprint §2.3). */
export type LensId = 'files' | 'functions' | 'markers' | 'duplicates';

export const LENS_IDS: LensId[] = ['files', 'functions', 'markers', 'duplicates'];

export function parseLens(raw: string | null): LensId {
  return LENS_IDS.find(id => id === raw) ?? 'files';
}

export interface LensArgs {
  folder: FolderRow;
  /** The toolbar's shared search box. Every lens filters paths with it. */
  query: string;
  /** Empties the shared search box — the query counts as an active filter. */
  clearQuery: () => void;
  /** Only the visible lens fetches; the others keep whatever they had. */
  active: boolean;
}

/**
 * What a lens hands back to `CodeView`, which owns the one `Toolbar` the four
 * of them share.
 */
export interface CodeLens {
  /** Rows available in this lens, for its chip. `undefined` until known. */
  count?: number;
  /** The toolbar's second row while this lens is active. */
  filters?: React.ReactNode;
  /** Demoted, lens-specific actions for the toolbar `⋯`. */
  overflow?: MenuItem[];
  /** Row counts and the metrics that are too wide for a tile strip. */
  subtitle?: React.ReactNode;
  /** Metrics with no lens chip of their own (blueprint §2.3). */
  metrics?: React.ReactNode;
  searchPlaceholder?: string;
  content: React.ReactNode;
}

export interface LensMetric {
  label: string;
  value: string;
  icon?: LucideIcon;
}

/**
 * The `metric-card` rows that used to sit above these tables. Metrics that have
 * a lens chip live in the chip; the rest stay visible here at every width.
 */
export function LensMetrics({ items }: { items: LensMetric[] }) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
      {items.map(item => (
        <StatTile key={item.label} icon={item.icon} label={item.label} value={item.value} />
      ))}
    </div>
  );
}

export type SortValue = string | number | null;

/**
 * The one comparator behind every sortable lens column, lifted verbatim from
 * `FilesView.tsx:86-103` (strings collate by locale, absent dates sort as -1).
 * `DataTable` owns the header affordance, so the per-page `header(k,label)`
 * helper and its ▲/▼/⇅ glyphs are gone.
 */
export function sortRows<Row>(
  rows: Row[],
  sort: SortState | null,
  locale: string,
  value: (row: Row, columnId: string) => SortValue,
): Row[] {
  if (!sort) return rows;
  const asc = sort.direction === 'asc';
  return [...rows].sort((a, b) => {
    const va = value(a, sort.columnId);
    const vb = value(b, sort.columnId);
    if (typeof va === 'string' && typeof vb === 'string') {
      return asc ? va.localeCompare(vb, locale) : vb.localeCompare(va, locale);
    }
    const na = Number(va ?? -1);
    const nb = Number(vb ?? -1);
    return asc ? na - nb : nb - na;
  });
}
