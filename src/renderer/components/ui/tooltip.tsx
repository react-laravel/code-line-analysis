// synced from mysql-compare/src/renderer/components/ui — Doge Desktop Design System
import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { useFloating } from './_internal/hooks';
import type { Side } from './_internal/types';

export interface TooltipProps {
  content: React.ReactNode;
  side?: Side;
  /** 400ms, or 0 when another tooltip was shown less than 300ms ago. */
  delayMs?: number;
  disabled?: boolean;
  children: React.ReactElement;
}

/** One module-level clock so moving along a toolbar shows the next tip instantly. */
let lastShownAt = 0;

export function Tooltip({ content, side = 'bottom', delayMs = 400, disabled, children }: TooltipProps) {
  const anchorRef = useRef<HTMLElement | null>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);

  const style = useFloating(anchorRef, floatingRef, { side, align: 'center', offset: 6, open });

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const show = useCallback(() => {
    if (disabled) return;
    clear();
    const wait = Date.now() - lastShownAt < 300 ? 0 : delayMs;
    timer.current = window.setTimeout(() => {
      lastShownAt = Date.now();
      setOpen(true);
    }, wait);
  }, [clear, delayMs, disabled]);

  const hide = useCallback(() => {
    clear();
    setOpen(false);
  }, [clear]);

  useEffect(() => clear, [clear]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!isValidElement(children)) return children;

  const trigger = cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      const forwarded = (children.props as { ref?: React.Ref<HTMLElement> }).ref;
      if (typeof forwarded === 'function') forwarded(node);
      else if (forwarded && typeof forwarded === 'object') {
        (forwarded as React.MutableRefObject<HTMLElement | null>).current = node;
      }
    },
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
  });

  return (
    <>
      {trigger}
      {open && !disabled
        ? createPortal(
            <div
              ref={floatingRef}
              role="tooltip"
              style={style ?? { position: 'fixed', top: -9999, left: -9999 }}
              className={cn(
                'pointer-events-none z-[var(--ds-z-tooltip)] flex items-center gap-1.5 rounded-md',
                'border border-border-strong bg-raised px-1.5 py-1 text-2xs text-fg shadow-raised',
              )}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
