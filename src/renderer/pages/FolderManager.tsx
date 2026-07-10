import React, { useEffect, useState } from 'react';
import { Save, ShieldCheck } from 'lucide-react';
import type { FolderRow, FolderRules } from '../../shared/api';
import { useI18n } from '../i18n';
import PageHeader from '../components/PageHeader';

interface Props { folder: FolderRow | null; }

function normalizeRules(value: FolderRules | null | undefined): FolderRules {
  return {
    whitelist: Array.isArray(value?.whitelist) ? value.whitelist : [],
    blacklist: Array.isArray(value?.blacklist) ? value.blacklist : [],
  };
}

export default function FolderManager({ folder }: Props) {
  const [rules, setRules] = useState<FolderRules>({ whitelist: [], blacklist: [] });
  const [whiteText, setWhiteText] = useState('');
  const [blackText, setBlackText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const { locale, t } = useI18n();

  useEffect(() => {
    if (!folder) return;
    window.api.folders.getRules(folder.id).then(r => {
      const nextRules = normalizeRules(r);
      setRules(nextRules);
      setWhiteText(nextRules.whitelist.join('\n'));
      setBlackText(nextRules.blacklist.join('\n'));
      setSaveMessage('');
      setSaveError('');
    });
  }, [folder?.id]);

  if (!folder) return <div className="empty">{t('common.selectFolder')}</div>;

  async function save() {
    const r: FolderRules = {
      whitelist: whiteText.split('\n').map(s => s.trim()).filter(Boolean),
      blacklist: blackText.split('\n').map(s => s.trim()).filter(Boolean),
    };

    setSaving(true);
    setSaveMessage('');
    setSaveError('');

    try {
      const response = await window.api.folders.setRules(folder!.id, r);
      const nextRules = Array.isArray(response?.whitelist) && Array.isArray(response?.blacklist)
        ? normalizeRules(response)
        : normalizeRules(await window.api.folders.getRules(folder!.id).catch(() => r));
      setRules(nextRules);
      setWhiteText(nextRules.whitelist.join('\n'));
      setBlackText(nextRules.blacklist.join('\n'));
      setSaveMessage(t('folderManager.saveApplied'));
    } catch {
      setSaveError(t('folderManager.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="folder-manager-page">
      <PageHeader
        eyebrow={folder.name}
        title={t('folderManager.rules')}
        description={t('folderManager.rulesHelp')}
        meta={folder.rootPath}
        actions={(
          <div className="status-pill folder-rules-status">
            <ShieldCheck aria-hidden="true" />
            {t('folderManager.activeRules', {
              whitelist: rules.whitelist.length.toLocaleString(locale),
              blacklist: rules.blacklist.length.toLocaleString(locale),
            })}
          </div>
        )}
      />
      <div className="rules-grid folder-rules-grid">
        <label className="rule-editor">
          <span className="rule-editor-heading">{t('folderManager.whitelist')}</span>
          <span className="rule-editor-copy">{t('folderManager.whitelistHelp')}</span>
          <textarea
            value={whiteText}
            onChange={e => {
              setWhiteText(e.target.value);
              setSaveMessage('');
              setSaveError('');
            }}
            rows={12}
            className="rules-textarea"
            placeholder={'src/**\nlib/**'}
          />
        </label>
        <label className="rule-editor">
          <span className="rule-editor-heading">{t('folderManager.blacklist')}</span>
          <span className="rule-editor-copy">{t('folderManager.blacklistHelp')}</span>
          <textarea
            value={blackText}
            onChange={e => {
              setBlackText(e.target.value);
              setSaveMessage('');
              setSaveError('');
            }}
            rows={12}
            className="rules-textarea"
            placeholder={'vendor\n**/__generated__/**'}
          />
        </label>
      </div>
      <div className="settings-actions folder-rules-actions">
        <button className="primary icon-text-button" onClick={save} disabled={saving}>
          <Save aria-hidden="true" />
          {saving ? t('folderManager.saving') : t('folderManager.save')}
        </button>
        {(saveMessage || saveError) && (
          <div className={saveError ? 'settings-field-note error' : 'settings-field-note success'}>
            {saveError || saveMessage}
          </div>
        )}
      </div>
    </div>
  );
}
