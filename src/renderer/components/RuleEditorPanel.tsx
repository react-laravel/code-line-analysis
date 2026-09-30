import { useCallback, useEffect, useRef, useState } from 'react';
import type { FolderRow, FolderRules } from '../../shared/api';
import { DEFAULT_BLACKLIST } from '../../shared/api';
import { Field } from './ui/field';
import { Input } from './ui/input';
import { Panel } from './ui/panel';
import { RuleEditor, type RuleScope } from './ui/rule-editor';
import { isFolderRulesResponse, readFolderRules, rulesFromText, rulesToText } from '../lib/folder-rules';
import { useI18n, type TranslationKey } from '../i18n';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';

const DUPLICATE_MIN_LINES_FLOOR = 3;

export interface RuleEditorPanelArgs {
  scope: RuleScope;
  folder: FolderRow | null;
  /** Only the mounted-and-visible panel loads. */
  active: boolean;
}

export interface RuleEditorPanelState {
  /** The rendered scope body — textareas, notes and the save state line. */
  node: React.ReactNode;
  /** Persists this scope. Resolves `false` when nothing was written. */
  save: () => Promise<boolean>;
  saving: boolean;
  loading: boolean;
  dirty: boolean;
  /** `false` when the scope cannot be edited at all (no folder / old backend). */
  editable: boolean;
}

function isDuplicateApiMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /No handler registered|(?:get|set)Duplicate(?:Rules|MinLines) is not a function/i.test(message);
}

/**
 * **One** rule editor, three scopes (DESIGN-SYSTEM §9 rule 3).
 *
 * This replaces three near-identical whitelist/blacklist textarea pairs, each
 * with its own load/save/error triple: the global pair in the old Settings
 * modal, the per-folder page at `/folders` (`pages/FolderManager.tsx`, now
 * deleted) and the duplicates drawer inside the Duplicates lens. The three
 * `normalizeRules` helpers had already collapsed into `lib/folder-rules.ts`;
 * this collapses what was left.
 *
 * It is a hook rather than a component so the Settings dialog's footer can own
 * `Save` / `Save & Rescan` — one primary button per view, and `⌘S` has exactly
 * one thing to submit.
 */
export function useRuleEditorPanel({ scope, folder, active }: RuleEditorPanelArgs): RuleEditorPanelState {
  const { t } = useI18n();

  const [allow, setAllow] = useState('');
  const [block, setBlock] = useState('');
  const [minLines, setMinLines] = useState('8');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savedAt, setSavedAt] = useState<number | undefined>(undefined);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [duplicateApiMissing, setDuplicateApiMissing] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [baseline, setBaseline] = useState({ allow: '', block: '', minLines: '8' });
  const [retry, setRetry] = useState(0);
  const operation = useRef(0);
  const pendingSave = useRef(false);

  const folderId = folder?.id ?? null;
  const scopeKey = `${scope}:${folderId ?? 'none'}`;
  const needsFolder = scope !== 'global' && folderId == null;
  // Feature detection against an older backend, kept from the duplicates
  // drawer (`DuplicatesView.tsx:44-45`) — but scoped to this panel instead of
  // rendering as a permanent page-level error (blueprint §3.6).
  const duplicateApisPresent =
    typeof window.api.folders.getDuplicateRules === 'function' &&
    typeof window.api.folders.setDuplicateRules === 'function' &&
    typeof window.api.folders.getDuplicateMinLines === 'function' &&
    typeof window.api.folders.setDuplicateMinLines === 'function';
  const available =
    !needsFolder && (scope !== 'duplicates' || (duplicateApisPresent && !duplicateApiMissing));
  const editable = active && available && loadedKey === scopeKey && !loading;
  const dirty =
    editable &&
    (allow !== baseline.allow ||
      block !== baseline.block ||
      (scope === 'duplicates' && minLines !== baseline.minLines));
  const error = errorKey ? t(errorKey) : '';

  // Latest values for the save callback, so it does not change identity on
  // every keystroke (the dialog footer holds on to it).
  const latest = useRef({ allow, block, minLines, scope, folderId, active, editable, scopeKey });
  latest.current = { allow, block, minLines, scope, folderId, active, editable, scopeKey };

  useEffect(() => {
    const token = ++operation.current;
    setLoadedKey(null);
    setAllow('');
    setBlock('');
    setMinLines('8');
    setSavedAt(undefined);
    setErrorKey(null);
    setDuplicateApiMissing(false);
    setLoading(false);
    if (!active || needsFolder) return;
    if (scope === 'duplicates' && !duplicateApisPresent) {
      setDuplicateApiMissing(true);
      return;
    }
    setLoading(true);
    const isCurrent = () => operation.current === token;

    async function load(): Promise<{ rules: FolderRules; count: number }> {
      if (scope === 'global')
        return { rules: readFolderRules(await window.api.settings.getGlobalRules()), count: 8 };
      if (scope === 'folder')
        return { rules: readFolderRules(await window.api.folders.getRules(folderId as number)), count: 8 };
      const [rules, count] = await Promise.all([
        window.api.folders.getDuplicateRules(folderId as number),
        window.api.folders.getDuplicateMinLines(folderId as number),
      ]);
      return { rules: readFolderRules(rules), count };
    }

    void load()
      .then(({ rules, count }) => {
        if (!isCurrent()) return;
        const text = rulesToText(rules);
        setAllow(text.allow);
        setBlock(text.block);
        setMinLines(String(count));
        setBaseline({ ...text, minLines: String(count) });
        setLoadedKey(scopeKey);
      })
      .catch((loadError) => {
        if (!isCurrent()) return;
        if (scope === 'duplicates' && isDuplicateApiMissing(loadError)) setDuplicateApiMissing(true);
        else setErrorKey('common.loadFailed');
      })
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });

    return () => {
      operation.current += 1;
    };
  }, [active, duplicateApisPresent, folderId, needsFolder, scope, scopeKey, retry]);

  const save = useCallback(async (): Promise<boolean> => {
    const current = latest.current;
    if (!current.active || !current.editable || pendingSave.current) return false;
    if (current.scope !== 'global' && current.folderId == null) return false;

    const payload = rulesFromText(current.allow, current.block);
    const parsedMinLines = Number(current.minLines);
    if (
      current.scope === 'duplicates' &&
      (!Number.isInteger(parsedMinLines) || parsedMinLines < DUPLICATE_MIN_LINES_FLOOR)
    ) {
      setErrorKey('settings.duplicateMinLinesError');
      return false;
    }

    // Ref-level lock also covers repeated shortcuts before React rerenders.
    pendingSave.current = true;
    const token = operation.current;
    const isCurrent = () =>
      token === operation.current && latest.current.active && latest.current.scopeKey === current.scopeKey;
    setSaving(true);
    setSavedAt(undefined);
    setErrorKey(null);
    let thresholdWritten = false;

    try {
      let response: typeof payload;
      if (current.scope === 'global') {
        response = await window.api.settings.setGlobalRules(payload);
      } else if (current.scope === 'folder') {
        response = await window.api.folders.setRules(current.folderId as number, payload);
      } else {
        await window.api.folders.setDuplicateMinLines(current.folderId as number, parsedMinLines);
        thresholdWritten = true;
        response = await window.api.folders.setDuplicateRules(current.folderId as number, payload);
      }

      if (!isCurrent()) return false;
      // Some backends answer with an empty ack; retain the submitted payload.
      const persisted = isFolderRulesResponse(response) ? readFolderRules(response) : payload;
      const text = rulesToText(persisted);
      setBaseline({ ...text, minLines: String(parsedMinLines) });
      // Normally editing is locked during a save; keep a newer draft intact
      // even if an external caller changed it while the request was in flight.
      if (
        latest.current.allow === current.allow &&
        latest.current.block === current.block &&
        latest.current.minLines === current.minLines
      ) {
        setAllow(text.allow);
        setBlock(text.block);
        setSavedAt(Date.now());
      }
      return true;
    } catch (saveError) {
      if (!isCurrent()) return false;
      if (current.scope === 'duplicates' && isDuplicateApiMissing(saveError)) {
        setDuplicateApiMissing(true);
        setErrorKey(thresholdWritten ? 'settings.duplicatePartialSave' : 'duplicates.rulesUnavailable');
      } else {
        setErrorKey(
          thresholdWritten
            ? 'settings.duplicatePartialSave'
            : current.scope === 'global'
              ? 'settings.saveFailed'
              : 'folderManager.saveFailed',
        );
      }
      return false;
    } finally {
      pendingSave.current = false;
      setSaving(false);
    }
  }, []);

  const help =
    scope === 'global'
      ? t('settings.globalRulesHelp')
      : scope === 'folder'
        ? t('folderManager.rulesHelp')
        : t('duplicates.rulesHelp');

  const node = (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-xs text-fg-muted">{help}</p>

      {needsFolder ? (
        <Panel tone="danger">
          <p className="m-0 text-xs text-danger-text">{t('settings.scopeNeedsFolder')}</p>
        </Panel>
      ) : null}

      {scope === 'duplicates' && !needsFolder && !available ? (
        <Panel tone="danger">
          <p className="m-0 text-xs text-danger-text">{t('duplicates.rulesUnavailable')}</p>
        </Panel>
      ) : null}

      {loading ? (
        <div role="status">
          <Spinner label={t('settings.loading')} />
        </div>
      ) : null}
      {!loading && errorKey === 'common.loadFailed' ? (
        <Button className="self-start" onClick={() => setRetry((value) => value + 1)}>
          {t('settings.retry')}
        </Button>
      ) : null}

      <RuleEditor
        scope={scope}
        allow={allow}
        block={block}
        blockPlaceholder={scope === 'global' ? DEFAULT_BLACKLIST.join('\n') : undefined}
        showSave={false}
        disabled={!editable || saving}
        onChange={(next) => {
          setAllow(next.allow);
          setBlock(next.block);
          setSavedAt(undefined);
          setErrorKey(null);
        }}
        onSave={async () => {
          await save();
        }}
        state={{ saving, error: error || undefined, savedAt }}
        labels={{
          allow: scope === 'global' ? t('settings.globalWhitelist') : t('folderManager.whitelist'),
          block: scope === 'global' ? t('settings.globalBlacklist') : t('folderManager.blacklist'),
          allowHint: t('folderManager.whitelistHelp'),
          blockHint: t('folderManager.blacklistHelp'),
          save: t('settings.save'),
          savedAt: () => t('settings.savedApplies'),
        }}
      />

      {scope === 'duplicates' && available ? (
        <Field
          label={t('settings.duplicateMinLines')}
          hint={t('settings.duplicateMinLinesHelp')}
          error={errorKey === 'settings.duplicateMinLinesError' ? error : undefined}
        >
          <Input
            type="number"
            disabled={!editable || saving}
            inputMode="numeric"
            min={DUPLICATE_MIN_LINES_FLOOR}
            className="w-28"
            value={minLines}
            onChange={(event) => {
              setMinLines(event.target.value);
              setSavedAt(undefined);
              setErrorKey(null);
            }}
          />
        </Field>
      ) : null}

      <p className="m-0 rounded-md border border-border bg-surface-2 p-3 text-xs leading-relaxed text-fg-muted">
        {t('settings.rulesPrecedence')}
      </p>
      {dirty ? <p className="m-0 text-xs text-fg-muted">{t('settings.unsavedHelp')}</p> : null}
    </div>
  );

  return { node, save, saving, loading, dirty, editable };
}
