import { cn } from '../lib/utils';
import { splitRelPath } from '../lib/path';

interface Props {
  path: string;
  className?: string;
  layout?: 'inline' | 'stacked';
}

/** Filename first so it stays readable; the directory recedes and truncates. */
export default function PathCell({ path, className, layout = 'inline' }: Props) {
  const { dir, name } = splitRelPath(path);
  return (
    <span
      className={cn(
        'w-full min-w-0 overflow-hidden font-mono text-xs',
        layout === 'stacked' ? 'grid gap-0.5' : 'flex items-baseline gap-2',
        className,
      )}
      title={path}
    >
      <span className={cn('min-w-0 truncate text-fg', layout === 'stacked' ? 'text-sm font-medium' : dir && 'max-w-[70%] shrink-0')}>{name}</span>
      {dir ? <span className={cn('min-w-0 truncate text-fg-muted', layout === 'stacked' && 'text-2xs')}>{dir}</span> : null}
    </span>
  );
}
