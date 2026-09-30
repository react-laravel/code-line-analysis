import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Code2, FolderOpen, Globe2, Info, ListTree, Moon, Palette, Sun } from 'lucide-react';
import { isMac } from '../components/ui/_internal/hooks';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/checkbox';
import { Dialog } from '../components/ui/dialog';
import { Field } from '../components/ui/field';
import { Kbd } from '../components/ui/kbd';
import type { RuleScope } from '../components/ui/rule-editor';
import { Select } from '../components/ui/select';
import { ToggleGroup, type ToggleOption } from '../components/ui/toggle-group';
import { useRuleEditorPanel } from '../components/RuleEditorPanel';
import { useI18n, type Language } from '../i18n';
import { useTheme, type ThemeMode } from '../theme';
import { useActiveFolder, useAppStore, type SettingsTab } from '../store/app-store';
import { useFolderActions } from '../hooks/useFolderActions';
import { cn } from '../lib/utils';

const RULE_SCOPES: RuleScope[] = ['global', 'folder', 'duplicates'];

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h4 className="m-0 text-xs font-semibold text-fg-muted">{title}</h4>
      <div className="divide-y divide-border rounded-lg border border-border bg-surface [&>div]:p-4">
        {children}
      </div>
    </section>
  );
}

function ThemePreview({ mode }: { mode: ThemeMode }) {
  // Neutral, fixed preview colors keep both choices recognizable in either theme.
  return (
    <span
      aria-hidden
      className={cn(
        'mb-3 flex h-28 overflow-hidden rounded-md border',
        mode === 'light' ? 'border-slate-300 bg-slate-50' : 'border-slate-600 bg-slate-900',
      )}
    >
      <span
        className={cn(
          'flex w-1/4 flex-col gap-2 border-r p-2.5',
          mode === 'light' ? 'border-slate-200 bg-slate-100' : 'border-slate-700 bg-slate-800',
        )}
      >
        <span className="mb-1 h-2 w-3 rounded-sm bg-blue-400" />
        <span className="h-1.5 w-full rounded-sm bg-blue-400/60" />
        <span className="h-1.5 w-3/4 rounded-sm bg-slate-400/40" />
        <span className="h-1.5 w-full rounded-sm bg-slate-400/40" />
      </span>
      <span className="flex flex-1 flex-col gap-2.5 p-3">
        <span className={cn('h-2 w-2/3 rounded-sm', mode === 'light' ? 'bg-slate-400' : 'bg-slate-500')} />
        <span className="grid grid-cols-3 gap-1.5">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className={cn(
                'h-6 rounded border',
                mode === 'light' ? 'border-slate-200 bg-white' : 'border-slate-700 bg-slate-800',
              )}
            />
          ))}
        </span>
        <span className="h-1.5 w-full rounded-sm bg-slate-400/25" />
        <span className="h-1.5 w-4/5 rounded-sm bg-slate-400/25" />
      </span>
    </span>
  );
}

/**
 * `⌘,` — the Settings modal from `App.tsx:590-686`, now a real `Dialog` with
 * four tabs (blueprint §2.7). The hand-written focus trap at `App.tsx:197-227`
 * was correct and is the behaviour `useFocusTrap` inherited; `Dialog` supplies
 * the trap, the focus restore, `aria-modal` and `aria-labelledby`.
 *
 * Setup lives here, never in the nav (DESIGN-SYSTEM §9 rule 2): the `/folders`
 * route is gone and its rules are the `folder` scope of the one `RuleEditor`,
 * as are the duplicates drawer's.
 */
export default function SettingsDialog() {
  const { language, languageOptions, setLanguage, t } = useI18n();
  const { theme, setTheme } = useTheme();
  const folder = useActiveFolder();
  const actions = useFolderActions();
  const id = useId();
  const navRef = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<HTMLButtonElement>(null);
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 640px)').matches);

  useEffect(() => {
    const query = window.matchMedia('(min-width: 640px)');
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const open = useAppStore((state) => state.settingsOpen);
  const setOpen = useAppStore((state) => state.setSettingsOpen);
  const tab = useAppStore((state) => state.settingsTab);
  const setTab = useAppStore((state) => state.setSettingsTab);
  const scope = useAppStore((state) => state.settingsScope);
  const setScope = useAppStore((state) => state.setSettingsScope);
  const autoScanOnOpen = useAppStore((state) => state.autoScanOnOpen);
  const setAutoScanOnOpen = useAppStore((state) => state.setAutoScanOnOpen);
  const restoreLastFolder = useAppStore((state) => state.restoreLastFolder);
  const setRestoreLastFolder = useAppStore((state) => state.setRestoreLastFolder);
  const detectDuplicates = useAppStore((state) => state.detectDuplicatesOnScan);
  const setDetectDuplicates = useAppStore((state) => state.setDetectDuplicatesOnScan);

  const rulesTabActive = open && tab === 'rules';
  const rules = useRuleEditorPanel({ scope, folder, active: rulesTabActive });

  // A scope that needs a folder cannot be the landing scope when there is none.
  useEffect(() => {
    if (rulesTabActive && folder == null && scope !== 'global') setScope('global');
  }, [folder, rulesTabActive, scope, setScope]);

  // `⌘S` submits the rule editor (blueprint §4.2). It is registered only while
  // the rules tab is open, so it never races the editor tab's own `⌘S`.
  const saveRules = rules.save;
  useEffect(() => {
    if (!rulesTabActive) return;
    function onKeyDown(event: KeyboardEvent): void {
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (!mod || event.altKey || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      void saveRules();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rulesTabActive, saveRules]);

  const tabItems = useMemo(
    () => [
      {
        value: 'general',
        label: t('settings.generalTab'),
        description: t('settings.generalDescription'),
        icon: Globe2,
      },
      {
        value: 'rules',
        label: t('settings.rulesTab'),
        description: t('settings.rulesDescription'),
        icon: ListTree,
      },
      {
        value: 'appearance',
        label: t('settings.appearanceTab'),
        description: t('settings.appearanceDescription'),
        icon: Palette,
      },
      {
        value: 'about',
        label: t('settings.aboutTab'),
        description: t('settings.aboutDescription'),
        icon: Info,
      },
    ],
    [t],
  );
  const currentTab = tabItems.find((item) => item.value === tab)!;

  const scopeOptions: ToggleOption<RuleScope>[] = RULE_SCOPES.map((value) => ({
    value,
    label:
      value === 'global'
        ? t('settings.scopeGlobal')
        : value === 'folder'
          ? t('settings.scopeFolderShort')
          : t('settings.scopeDuplicates'),
    disabled: rules.saving || (value !== 'global' && folder == null),
    disabledReason: rules.saving ? t('settings.saving') : t('settings.scopeNeedsFolder'),
  }));

  function navigateSettings(event: React.KeyboardEvent<HTMLDivElement>): void {
    const index = tabItems.findIndex((item) => item.value === tab);
    let next: number;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % tabItems.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft')
      next = (index - 1 + tabItems.length) % tabItems.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabItems.length - 1;
    else return;
    event.preventDefault();
    if (rules.saving) return;
    setTab(tabItems[next].value as SettingsTab);
    navRef.current
      ?.querySelector<HTMLButtonElement>(`[data-settings-tab="${tabItems[next].value}"]`)
      ?.focus();
  }

  async function saveAndRescan(): Promise<void> {
    // A rule change that is not re-applied is a rule change that did nothing
    // (blueprint §3.5), so this is the primary footer action.
    const targetId = folder?.id;
    if ((await rules.save()) && targetId === useAppStore.getState().activeFolderId) actions.rescan();
  }

  const footer = (
    <>
      <p
        role="status"
        className={cn(
          'm-0 mr-auto flex min-w-0 items-center gap-1.5 text-xs',
          rulesTabActive && rules.dirty ? 'text-warning-text' : 'text-fg-muted',
        )}
      >
        {rulesTabActive ? (
          rules.saving ? (
            t('settings.saving')
          ) : rules.loading ? (
            t('settings.loading')
          ) : rules.dirty ? (
            t('settings.unsavedChanges')
          ) : (
            t('settings.rulesApply')
          )
        ) : tab === 'about' ? null : (
          <>
            <Check aria-hidden size={13} />
            {t('settings.instantApply')}
          </>
        )}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={rules.saving} onClick={() => setOpen(false)}>
          {t('common.close')}
        </Button>
        {tab === 'rules' ? (
          <>
            <Button disabled={!rules.editable || rules.saving} onClick={() => void rules.save()}>
              {t('settings.save')}
              <Kbd className="ml-0.5 hidden sm:inline-flex">Mod+S</Kbd>
            </Button>
            <Button
              variant="primary"
              loading={rules.saving}
              disabled={!rules.editable || rules.saving || folder == null || !folder.isAvailable}
              onClick={() => void saveAndRescan()}
            >
              {t('settings.saveAndRescan')}
            </Button>
          </>
        ) : null}
      </div>
    </>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="xl"
      title={t('app.settings')}
      description={t('settings.subtitle')}
      closeLabel={t('common.close')}
      dismissible={!rules.saving}
      initialFocus={initialFocus}
      className="h-[600px] max-h-[calc(100dvh-32px)] overflow-hidden bg-surface"
      backdropClassName="items-center p-4 pt-4"
      bodyClassName="flex overflow-hidden p-0"
      footerClassName="shrink-0 flex-wrap items-center bg-surface-2"
      footer={footer}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col sm:flex-row">
        <aside className="flex shrink-0 flex-col border-b border-border bg-surface-2 p-2 sm:w-48 sm:border-r sm:border-b-0 sm:p-3">
          <div
            ref={navRef}
            role="tablist"
            aria-label={t('app.settings')}
            aria-orientation={wide ? 'vertical' : 'horizontal'}
            onKeyDown={navigateSettings}
            className="grid grid-cols-4 gap-1 sm:flex sm:flex-col"
          >
            {tabItems.map((item) => {
              const selected = item.value === tab;
              const Icon = item.icon;
              return (
                <button
                  key={item.value}
                  ref={selected ? initialFocus : undefined}
                  type="button"
                  role="tab"
                  id={`${id}-${item.value}`}
                  aria-controls={`${id}-panel-${item.value}`}
                  aria-selected={selected}
                  data-settings-tab={item.value}
                  tabIndex={selected ? 0 : -1}
                  disabled={rules.saving}
                  onClick={() => setTab(item.value as SettingsTab)}
                  className={cn(
                    'flex min-w-0 items-center justify-center gap-2 rounded-md px-2 py-2.5 text-xs font-medium transition-colors sm:justify-start sm:px-3 sm:text-sm',
                    selected
                      ? 'bg-accent-quiet text-accent-text'
                      : 'text-fg-muted hover:bg-hover hover:text-fg',
                    'disabled:cursor-wait',
                  )}
                >
                  <Icon aria-hidden size={16} className="hidden shrink-0 sm:block" />
                  <span className="min-w-0 break-words">{item.label}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-auto hidden items-center gap-2 px-3 pt-5 text-2xs text-fg-subtle sm:flex">
            <Code2 aria-hidden size={14} />
            <span>
              Code Line Analysis
              <br />
              <span className="font-mono">v{__APP_VERSION__}</span>
            </span>
          </div>
        </aside>
        <div
          id={`${id}-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`${id}-${tab}`}
          tabIndex={0}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6"
        >
          <header className="mb-5">
            <h3 className="m-0 text-lg font-semibold tracking-tight text-fg">{currentTab.label}</h3>
            <p className="mt-1 mb-0 text-xs leading-relaxed text-fg-muted">{currentTab.description}</p>
          </header>
          <div className="flex flex-col gap-5">
            {tab === 'general' ? (
              <>
                <SettingsSection title={t('settings.preferencesGroup')}>
                  <div className="grid items-center gap-3 sm:grid-cols-[1fr_160px]">
                    <div>
                      <label htmlFor={`${id}-language`} className="text-sm text-fg">
                        {t('app.language')}
                      </label>
                      <p
                        id={`${id}-language-help`}
                        className="mt-1 mb-0 text-xs leading-relaxed text-fg-muted"
                      >
                        {t('settings.languageHelp')}
                      </p>
                    </div>
                    <Select
                      id={`${id}-language`}
                      aria-describedby={`${id}-language-help`}
                      value={language}
                      onChange={(event) => setLanguage(event.target.value as Language)}
                      options={languageOptions.map((option) => ({ value: option.code, label: option.label }))}
                    />
                  </div>
                </SettingsSection>
                <SettingsSection title={t('settings.startupGroup')}>
                  <div>
                    <Switch
                      checked={restoreLastFolder}
                      onCheckedChange={setRestoreLastFolder}
                      label={t('settings.restoreLastFolder')}
                      description={t('settings.restoreLastFolderHelp')}
                    />
                  </div>
                  <div>
                    <Switch
                      checked={autoScanOnOpen}
                      onCheckedChange={setAutoScanOnOpen}
                      label={t('settings.autoScanOnOpen')}
                      description={t('settings.autoScanOnOpenHelp')}
                    />
                  </div>
                </SettingsSection>
                <SettingsSection title={t('settings.analysisGroup')}>
                  <div>
                    <Switch
                      checked={detectDuplicates}
                      onCheckedChange={setDetectDuplicates}
                      label={t('settings.detectDuplicates')}
                      description={t('settings.detectDuplicatesHelp')}
                    />
                  </div>
                </SettingsSection>
              </>
            ) : null}
            {tab === 'rules' ? (
              <>
                <div className="rounded-lg border border-border bg-surface-2 p-3">
                  <Field label={t('settings.scope')}>
                    <ToggleGroup
                      aria-label={t('settings.scope')}
                      value={scope}
                      onValueChange={setScope}
                      options={scopeOptions}
                    />
                  </Field>
                  {scope !== 'global' && folder ? (
                    <p className="mt-2 mb-0 break-all text-xs text-fg-muted">
                      {t('settings.ruleContext', { name: folder.name })}
                    </p>
                  ) : null}
                </div>
                {rules.node}
              </>
            ) : null}
            {tab === 'appearance' ? (
              <>
                <fieldset className="m-0 min-w-0 border-0 p-0">
                  <legend className="mb-3 text-xs font-semibold text-fg-muted">
                    {t('settings.colorMode')}
                  </legend>
                  <div className="grid grid-cols-2 gap-3">
                    {(['light', 'dark'] as const).map((mode) => {
                      const selected = theme === mode;
                      const Icon = mode === 'light' ? Sun : Moon;
                      return (
                        <label key={mode} className="relative min-w-0 cursor-pointer">
                          <input
                            type="radio"
                            name="settings-theme"
                            value={mode}
                            checked={selected}
                            onChange={() => setTheme(mode)}
                            className="peer sr-only"
                          />
                          <span
                            className={cn(
                              'block rounded-lg border p-2.5 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
                              selected
                                ? 'border-accent bg-accent-quiet'
                                : 'border-border bg-surface hover:border-border-strong',
                            )}
                          >
                            <ThemePreview mode={mode} />
                            <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
                              <Icon aria-hidden size={14} />
                              {t(mode === 'light' ? 'settings.themeLight' : 'settings.themeDark')}
                              <span
                                aria-hidden
                                className={cn(
                                  'ml-auto flex size-4 items-center justify-center rounded-full border',
                                  selected
                                    ? 'border-accent bg-accent text-accent-fg'
                                    : 'border-border-strong',
                                )}
                              >
                                {selected ? <Check size={11} /> : null}
                              </span>
                            </span>
                            <span className="mt-1 block text-xs text-fg-muted">
                              {t(mode === 'light' ? 'settings.themeLightHelp' : 'settings.themeDarkHelp')}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <p className="m-0 flex items-start gap-2 text-xs leading-relaxed text-fg-muted">
                  <Info aria-hidden size={14} className="mt-0.5 shrink-0" />
                  {t('settings.themeHelp')}
                </p>
              </>
            ) : null}
            {tab === 'about' ? (
              <>
                <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-4">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent-quiet text-accent-text">
                    <Code2 aria-hidden size={24} strokeWidth={1.6} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="m-0 text-base font-semibold text-fg">Code Line Analysis</h4>
                    <p className="mt-1 mb-0 text-xs leading-relaxed text-fg-muted">
                      {t('settings.aboutHelp')}
                    </p>
                  </div>
                </div>
                <section aria-label={t('settings.appInfo')}>
                  <dl className="m-0 divide-y divide-border rounded-lg border border-border bg-surface text-sm">
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <dt className="text-fg-muted">{t('settings.version')}</dt>
                      <dd className="m-0 rounded border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs text-fg">
                        {__APP_VERSION__}
                      </dd>
                    </div>
                    <div className="flex items-start justify-between gap-3 px-4 py-3">
                      <dt className="shrink-0 text-fg-muted">{t('settings.runtime')}</dt>
                      {/* Risk 7: the browser mock must always be visible as such. */}
                      <dd className="m-0 text-right text-fg">
                        {window.api.runtime.mode === 'mock'
                          ? t('settings.runtimeMock')
                          : t('settings.runtimeTauri')}
                      </dd>
                    </div>
                  </dl>
                </section>
                <section className="flex flex-col gap-2.5">
                  <h4 className="m-0 text-xs font-semibold text-fg-muted">{t('settings.workspaceGroup')}</h4>
                  <div className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4">
                    <FolderOpen aria-hidden size={18} className="mt-0.5 shrink-0 text-fg-subtle" />
                    <div className="min-w-0">
                      <p className="m-0 break-all text-sm font-medium text-fg">
                        {folder?.name ?? t('settings.noWorkspace')}
                      </p>
                      <p
                        className={cn(
                          'mt-1.5 mb-0 break-all text-xs leading-relaxed text-fg-muted',
                          folder && 'font-mono',
                        )}
                      >
                        {folder?.rootPath ?? t('settings.noWorkspaceHelp')}
                      </p>
                    </div>
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
