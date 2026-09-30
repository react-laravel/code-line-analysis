// synced from mysql-compare/src/renderer/components/ui — Doge Desktop Design System
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import type { Align, Side } from './types';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      element.tabIndex >= 0 && !element.matches(':disabled') && (element.offsetParent !== null || element === document.activeElement),
  );
}

/**
 * Trap focus inside `ref` while `active`, then restore it to whatever had focus
 * before. Ported from the hand-written, correct trap in `App.tsx:197-227`.
 */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  initialFocus?: React.RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const node = ref.current;
    if (!active || !node) return;

    const previous = document.activeElement as HTMLElement | null;
    const first = initialFocus?.current ?? focusableWithin(node)[0] ?? node;
    if (!node.hasAttribute('tabindex') && first === node) node.setAttribute('tabindex', '-1');
    first.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Tab' || !node) return;
      const items = focusableWithin(node);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      const activeElement = document.activeElement;
      if (!items.includes(activeElement as HTMLElement) && activeElement !== node) {
        event.preventDefault();
        (event.shiftKey ? tail : head).focus();
      } else if (event.shiftKey && (activeElement === head || activeElement === node)) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previous?.focus?.();
    };
  }, [ref, active, initialFocus]);
}

interface DismissOptions {
  onDismiss: () => void;
  outside?: boolean;
  escape?: boolean;
  active?: boolean;
}

/** One outside-click / Escape implementation for every floating surface. */
export function useDismiss(
  ref: React.RefObject<HTMLElement | null>,
  { onDismiss, outside = true, escape = true, active = true }: DismissOptions,
): void {
  const handler = useRef(onDismiss);
  handler.current = onDismiss;

  useEffect(() => {
    if (!active) return;

    function onPointerDown(event: MouseEvent): void {
      if (!outside) return;
      const node = ref.current;
      if (node && !node.contains(event.target as Node)) handler.current();
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (!escape || event.key !== 'Escape') return;
      event.stopPropagation();
      handler.current();
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, outside, escape, active]);
}

export interface FloatingOptions {
  side?: Side;
  align?: Align;
  offset?: number;
  /** Pointer-anchored surfaces (ContextMenu) pass a viewport point instead. */
  anchorPoint?: { x: number; y: number } | null;
  matchTriggerWidth?: boolean;
  open: boolean;
}

export interface FloatingStyle {
  position: 'fixed';
  top: number;
  left: number;
  minWidth?: number;
  maxHeight: number;
}

const VIEWPORT_MARGIN = 8;

/**
 * Positioning plus real viewport clamping. Replaces the four hand-rolled
 * clampers (only one of which clamped correctly) called out in PRIMITIVES §9.
 */
export function useFloating(
  anchorRef: React.RefObject<HTMLElement | null>,
  floatingRef: React.RefObject<HTMLElement | null>,
  { side = 'bottom', align = 'start', offset = 4, anchorPoint, matchTriggerWidth, open }: FloatingOptions,
): FloatingStyle | null {
  const [style, setStyle] = useState<FloatingStyle | null>(null);

  const compute = useCallback((): void => {
    const floating = floatingRef.current;
    if (!floating) return;

    const rect = anchorPoint
      ? new DOMRect(anchorPoint.x, anchorPoint.y, 0, 0)
      : anchorRef.current?.getBoundingClientRect();
    if (!rect) return;

    const box = floating.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = box.width || 1;
    const height = box.height || 1;

    let placement = side;
    if (placement === 'bottom' && rect.bottom + offset + height > vh - VIEWPORT_MARGIN) {
      if (rect.top - offset - height > VIEWPORT_MARGIN) placement = 'top';
    } else if (placement === 'top' && rect.top - offset - height < VIEWPORT_MARGIN) {
      if (rect.bottom + offset + height < vh - VIEWPORT_MARGIN) placement = 'bottom';
    } else if (placement === 'right' && rect.right + offset + width > vw - VIEWPORT_MARGIN) {
      placement = 'left';
    } else if (placement === 'left' && rect.left - offset - width < VIEWPORT_MARGIN) {
      placement = 'right';
    }

    let top: number;
    let left: number;
    if (placement === 'bottom' || placement === 'top') {
      top = placement === 'bottom' ? rect.bottom + offset : rect.top - offset - height;
      left =
        align === 'start'
          ? rect.left
          : align === 'end'
            ? rect.right - width
            : rect.left + rect.width / 2 - width / 2;
    } else {
      left = placement === 'right' ? rect.right + offset : rect.left - offset - width;
      top =
        align === 'start'
          ? rect.top
          : align === 'end'
            ? rect.bottom - height
            : rect.top + rect.height / 2 - height / 2;
    }

    left = Math.min(Math.max(VIEWPORT_MARGIN, left), Math.max(VIEWPORT_MARGIN, vw - width - VIEWPORT_MARGIN));
    top = Math.min(Math.max(VIEWPORT_MARGIN, top), Math.max(VIEWPORT_MARGIN, vh - height - VIEWPORT_MARGIN));

    setStyle({
      position: 'fixed',
      top,
      left,
      minWidth: matchTriggerWidth ? rect.width : undefined,
      maxHeight: vh - top - VIEWPORT_MARGIN,
    });
  }, [anchorRef, floatingRef, side, align, offset, anchorPoint, matchTriggerWidth]);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, compute]);

  return style;
}

/**
 * One tab stop per group; arrows move within it. Returns the props to spread on
 * each item and the index that currently owns the tab stop.
 */
export function useRovingTabIndex(count: number, activeIndex: number) {
  const [focusIndex, setFocusIndex] = useState(activeIndex);

  useEffect(() => {
    setFocusIndex(activeIndex);
  }, [activeIndex]);

  const move = useCallback(
    (delta: number): number => {
      if (count === 0) return 0;
      const next = (focusIndex + delta + count) % count;
      setFocusIndex(next);
      return next;
    },
    [count, focusIndex],
  );

  return { focusIndex, setFocusIndex, move };
}

/** Controlled / uncontrolled duality. */
export function useControllable<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
): [T, (next: T) => void] {
  const [internal, setInternal] = useState<T>(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? (value as T) : internal;
  const set = useCallback(
    (next: T) => {
      if (!isControlled) setInternal(next);
      onChange?.(next);
    },
    [isControlled, onChange],
  );
  return [current, set];
}

/**
 * Portal target. Defaults to `document.body`, but a Popover inside a Dialog
 * receives the dialog element so it inherits that stacking context
 * (DESIGN-SYSTEM §4).
 */
export function usePortal(container?: HTMLElement | null): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(container ?? document.body);
  }, [container]);
  return target;
}

/** `true` once `delayMs` has elapsed — skeletons never flash (DESIGN-SYSTEM §7.6). */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);
  return shown;
}

export const isMac =
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
