// synced from mysql-compare/src/renderer/components/ui — Doge Desktop Design System
import { useState } from 'react';
import { cn } from '../../lib/utils';
import { Button } from './button';
import { Field } from './field';
import { Textarea } from './input';

export type RuleScope = 'global' | 'folder' | 'duplicates';

export interface RuleEditorLabels {
  allow: string;
  block: string;
  save: string;
  allowHint?: string;
  blockHint?: string;
  savedAt?: (at: number) => string;
}

export interface RuleEditorProps {
  scope: RuleScope;
  allow: string;
  block: string;
  onChange: (next: { allow: string; block: string }) => void;
  onSave: () => Promise<void>;
  state?: { saving: boolean; error?: string; savedAt?: number };
  placeholder?: string;
  blockPlaceholder?: string;
  labels: RuleEditorLabels;
  className?: string;
  /**
   * `false` when the host owns the save affordance — a dialog footer, say —
   * so the editor renders only its save *state* and there is still exactly one
   * primary button on screen (DESIGN-SYSTEM §10). Defaults to `true`, which is
   * the standalone behaviour.
   */
  showSave?: boolean;
  disabled?: boolean;
}

/** Normalise a rule textarea: trim, drop blanks, de-duplicate, keep order. */
export function normalizeRules(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/** One glob allow/block pair for all three scopes (DESIGN-SYSTEM §9 rule 3). */
export function RuleEditor({
  scope,
  allow,
  block,
  onChange,
  onSave,
  state,
  placeholder = 'src/**\nlib/**',
  blockPlaceholder = 'vendor\n**/__generated__/**',
  labels,
  className,
  showSave = true,
  disabled = false,
}: RuleEditorProps) {
  const [pending, setPending] = useState(false);
  const saving = state?.saving ?? pending;

  async function save(): Promise<void> {
    setPending(true);
    try {
      await onSave();
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-scope={scope} className={cn('flex flex-col gap-3', className)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={labels.allow} hint={labels.allowHint}>
          <Textarea
            mono
            disabled={disabled || saving}
            value={allow}
            placeholder={placeholder}
            onChange={(event) => onChange({ allow: event.target.value, block })}
          />
        </Field>
        <Field label={labels.block} hint={labels.blockHint}>
          <Textarea
            mono
            disabled={disabled || saving}
            value={block}
            placeholder={blockPlaceholder}
            onChange={(event) => onChange({ allow, block: event.target.value })}
          />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        {showSave ? (
          <Button
            variant="primary"
            loading={saving}
            disabled={disabled || saving}
            onClick={() => void save()}
          >
            {labels.save}
          </Button>
        ) : null}
        {state?.error ? (
          <span role="alert" className="text-xs text-danger-text">
            {state.error}
          </span>
        ) : null}
        {!state?.error && state?.savedAt && labels.savedAt ? (
          <span role="status" className="text-xs text-success-text">
            {labels.savedAt(state.savedAt)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
