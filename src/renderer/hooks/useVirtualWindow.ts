import { useEffect, useState, type RefObject } from 'react';

export function useVirtualWindow(viewport: RefObject<HTMLDivElement | null>, count: number, rowHeight: number, enabled = true) {
  const [bounds, setBounds] = useState({ top: 0, height: 600 });
  useEffect(() => {
    const node = viewport.current;
    if (!node || !enabled) return;
    const update = () => setBounds({ top: node.scrollTop, height: node.clientHeight || 600 });
    update();
    node.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => { node.removeEventListener('scroll', update); observer.disconnect(); };
  }, [viewport, count, rowHeight, enabled]);
  const start = enabled ? Math.max(0, Math.min(count - 1, Math.floor(bounds.top / rowHeight) - 10)) : 0;
  const end = enabled ? Math.min(count, start + Math.ceil(bounds.height / rowHeight) + 21) : count;
  function refresh(): void {
    const node = viewport.current;
    if (node && enabled) setBounds({ top: node.scrollTop, height: node.clientHeight || 600 });
  }
  return { start, end, before: start * rowHeight, after: Math.max(0, count - end) * rowHeight, refresh };
}
