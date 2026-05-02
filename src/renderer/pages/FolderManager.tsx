import React, { useEffect, useState } from 'react';
import type { FolderRow, FolderRules } from '../../shared/api';
import { useI18n } from '../i18n';

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
    <div>
      <h1>{t('folderManager.title', { name: folder.name })}</h1>
      <div className="muted">{folder.rootPath}</div>

      <h2>{t('folderManager.rules')}</h2>
      <p className="muted">{t('folderManager.rulesHelp')}</p>
      <div className="rules-grid">
        <div>
          <h2>{t('folderManager.whitelist')}</h2>
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
        </div>
        <div>
          <h2>{t('folderManager.blacklist')}</h2>
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
        </div>
      </div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="primary" onClick={save} disabled={saving}>{saving ? t('folderManager.saving') : t('folderManager.save')}</button>
      </div>
      {(saveMessage || saveError) && (
        <div className={saveError ? 'settings-field-note error' : 'settings-field-note'}>
          {saveError || saveMessage}
        </div>
      )}
      <div className="muted">{t('folderManager.activeRules', { whitelist: rules.whitelist.length.toLocaleString(locale), blacklist: rules.blacklist.length.toLocaleString(locale) })}</div>
    </div>
  );
}
