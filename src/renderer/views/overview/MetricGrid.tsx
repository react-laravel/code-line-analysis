import type { LucideIcon } from 'lucide-react';
import { Skeleton, StatTile } from '../../components/ui';

export interface OverviewMetric {
  id: string;
  label: string;
  value: string;
  icon: LucideIcon;
  size?: 'sm' | 'md';
  hint?: string;
  className?: string;
}

const HERO = 3;
const REST = 6;

/** Hero row (files / lines / code) plus the secondary composition tiles. */
export function MetricGrid({ metrics }: { metrics: OverviewMetric[] }) {
  const hero = metrics.filter(item => item.size === 'md');
  const rest = metrics.filter(item => item.size !== 'md');
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3 min-[720px]:grid-cols-3">
        {hero.map(item => (
          <StatTile
            key={item.id}
            size={item.size}
            icon={item.icon}
            label={item.label}
            value={item.value}
            hint={item.hint}
            className={item.className}
          />
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        {rest.map(item => (
          <StatTile
            key={item.id}
            icon={item.icon}
            label={item.label}
            value={item.value}
            hint={item.hint}
          />
        ))}
      </div>
    </div>
  );
}

export function MetricGridSkeleton() {
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3 min-[720px]:grid-cols-3">
        {Array.from({ length: HERO }, (_, index) => (
          <Skeleton key={index} variant="tile" className="h-20" />
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        {Array.from({ length: REST }, (_, index) => (
          <Skeleton key={index} variant="tile" />
        ))}
      </div>
    </div>
  );
}
