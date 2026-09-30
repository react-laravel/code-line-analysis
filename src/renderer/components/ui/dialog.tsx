// synced from mysql-compare/src/renderer/components/ui — Doge Desktop Design System
import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';
import { IconButton } from './icon-button';
import { useDismiss, useFocusTrap } from './_internal/hooks';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** REQUIRED — wired to `aria-labelledby`. */
  title: React.ReactNode;
  description?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: React.ReactNode;
  initialFocus?: React.RefObject<HTMLElement | null>;
  /** `false` while a job inside the dialog runs. */
  dismissible?: boolean;
  className?: string;
  /** Optional layout hooks for larger, multi-pane dialogs. */
  bodyClassName?: string;
  backdropClassName?: string;
  footerClassName?: string;
  closeLabel?: string;
  children: React.ReactNode;
}

const SIZE = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  footer,
  initialFocus,
  dismissible = true,
  className,
  bodyClassName,
  backdropClassName,
  footerClassName,
  closeLabel = 'Close',
  children,
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useFocusTrap(ref, open, initialFocus);
  useDismiss(ref, {
    active: open,
    outside: dismissible,
    escape: dismissible,
    onDismiss: () => onOpenChange(false),
  });

  if (!open) return null;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[var(--ds-z-dialog)] flex items-start justify-center p-8 pt-[12vh]',
        backdropClassName,
      )}
    >
      <div className="absolute inset-0 bg-overlay" aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          'relative flex max-h-[80vh] w-full flex-col rounded-xl border border-border-strong',
          'bg-raised shadow-overlay',
          SIZE[size],
          className,
        )}
      >
        <header className="flex items-start gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-fg">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-0.5 text-xs text-fg-muted">
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <IconButton
              icon={X}
              label={closeLabel}
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            />
          ) : null}
        </header>
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-3', bodyClassName)}>{children}</div>
        {footer ? (
          <footer className={cn('flex justify-end gap-2 border-t border-border px-4 py-3', footerClassName)}>
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  body?: React.ReactNode;
  /** Rendered in mono in a tinted box — always name the object. */
  subject?: string;
  consequence?: React.ReactNode;
  tone?: 'default' | 'danger';
  confirmLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  secondaryConfirm?: { label: React.ReactNode; onConfirm: () => void | Promise<void> };
  /** The user must type this string before the confirm button enables. */
  requireTypedConfirmation?: string;
  onConfirm: () => void | Promise<void>;
}

/** Focuses Cancel on open; the destructive action is last (DESIGN-SYSTEM §7.5). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  subject,
  consequence,
  tone = 'danger',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  secondaryConfirm,
  requireTypedConfirmation,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState<'primary' | 'secondary' | null>(null);

  const locked = Boolean(requireTypedConfirmation) && typed !== requireTypedConfirmation;

  async function run(which: 'primary' | 'secondary'): Promise<void> {
    setPending(which);
    try {
      await (which === 'primary' ? onConfirm() : secondaryConfirm?.onConfirm());
      onOpenChange(false);
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      dismissible={pending === null}
      initialFocus={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} onClick={() => onOpenChange(false)} disabled={pending !== null}>
            {cancelLabel}
          </Button>
          {secondaryConfirm ? (
            <Button
              variant={tone === 'danger' ? 'danger-ghost' : 'secondary'}
              loading={pending === 'secondary'}
              disabled={locked || pending !== null}
              onClick={() => void run('secondary')}
            >
              {secondaryConfirm.label}
            </Button>
          ) : null}
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={pending === 'primary'}
            disabled={locked || pending !== null}
            onClick={() => void run('primary')}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm text-fg">
        {body ? <p className="m-0">{body}</p> : null}
        {subject ? (
          <p className="m-0 rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-xs break-all">
            {subject}
          </p>
        ) : null}
        {consequence ? <p className="m-0 text-xs text-danger-text">{consequence}</p> : null}
        {requireTypedConfirmation ? (
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            <span>
              Type <span className="font-mono text-fg">{requireTypedConfirmation}</span> to continue
            </span>
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              className="h-control-md rounded-md border border-border bg-inset px-2 font-mono text-sm text-fg"
            />
          </label>
        ) : null}
      </div>
    </Dialog>
  );
}

export interface DrawerProps extends Omit<DialogProps, 'size'> {
  side?: 'right' | 'bottom';
  size?: 'sm' | 'md';
}

const DRAWER_SIZE = {
  right: { sm: 'w-80', md: 'w-[440px]' },
  bottom: { sm: 'h-64', md: 'h-96' },
} as const;

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  side = 'right',
  size = 'md',
  footer,
  initialFocus,
  dismissible = true,
  className,
  closeLabel = 'Close',
  children,
}: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useFocusTrap(ref, open, initialFocus);
  useDismiss(ref, {
    active: open,
    outside: dismissible,
    escape: dismissible,
    onDismiss: () => onOpenChange(false),
  });

  if (!open) return null;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[var(--ds-z-dialog)] flex',
        side === 'right' ? 'justify-end' : 'items-end',
      )}
    >
      <div className="absolute inset-0 bg-overlay" aria-hidden />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          'relative flex max-w-full flex-col bg-raised shadow-overlay',
          side === 'right'
            ? cn('h-full border-l border-border-strong', DRAWER_SIZE.right[size])
            : cn('w-full border-t border-border-strong', DRAWER_SIZE.bottom[size]),
          className,
        )}
      >
        <header className="flex items-start gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-sm font-semibold text-fg">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-0.5 text-xs text-fg-muted">
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <IconButton
              icon={X}
              label={closeLabel}
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            />
          ) : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">{children}</div>
        {footer ? (
          <footer className="flex justify-end gap-2 border-t border-border px-3 py-2">{footer}</footer>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}
