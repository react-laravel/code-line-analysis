import { cn } from '../lib/utils';
import { splitRelPath } from '../lib/path';

interface Props {
  path: string;
  className?: string;
}

/** Filename first so it stays readable; the directory recedes and truncates. */
export default function PathCell({ path, className }: Props) {
  const { dir, name } = splitRelPath(path);
  return (
    <span className={cn('flex w-full min-w-0 items-baseline gap-1.5 overflow-hidden font-mono text-xs', className)} title={path}>
      <span className="shrink-0 text-fg">{name}</span>
      {dir ? <span className="min-w-0 truncate text-fg-subtle">{dir}</span> : null}
    </span>
  );
}
