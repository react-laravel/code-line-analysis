import { ScrollArea } from '../components/ui/scroll-area';
import { cn } from '../lib/utils';
import type { ContentLayout } from '../store/tabs-store';

interface Props {
  layout: ContentLayout;
  restoreKey?: string;
  progress?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The content pane under the tab strip. Layout is a route fact
 * (`contentLayoutOf`), not an editor special-case inside the shell.
 */
export default function ContentRegion({ layout, restoreKey, progress, children }: Props) {
  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-1 flex-col',
        layout === 'document' ? 'bg-surface' : 'bg-canvas',
      )}
    >
      {progress}
      {layout === 'document' ? (
        children
      ) : (
        <ScrollArea
          className="flex flex-col px-5 py-4 [&>*]:w-full"
          restoreKey={restoreKey}
        >
          {children}
        </ScrollArea>
      )}
    </div>
  );
}
