import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FolderRow, TopFile, TopFunction } from '../../shared/api';
import { useI18n } from '../i18n';

interface Props {
  folder: FolderRow | null;
  scanRevision: number;
}

export default function TopView({ folder, scanRevision }: Props) {
  const [files, setFiles] = useState<TopFile[]>([]);
  const [largeFiles, setLargeFiles] = useState<TopFile[]>([]);
  const [funcs, setFuncs] = useState<TopFunction[]>([]);
  const navigate = useNavigate();
  const { locale, t } = useI18n();

  useEffect(() => {
    if (!folder) return;
    window.api.stats.topFiles(folder.id, 50).then(setFiles);
    window.api.stats.topFiles(folder.id, 50, 'size').then(setLargeFiles);
    window.api.stats.topFunctions(folder.id, 50).then(setFuncs);
  }, [folder?.id, scanRevision]);

  if (!folder) return <div className="empty">{t('common.selectFolder')}</div>;

  return (
    <div>
      <h1>{t('top.title')}</h1>
      <h2>{t('top.largestFiles')}</h2>
      <table>
        <thead><tr><th>{t('common.path')}</th><th>{t('common.lang')}</th><th>{t('common.lines')}</th><th>{t('common.code')}</th></tr></thead>
        <tbody>
          {files.map(f => (
            <tr key={f.relPath} style={{ cursor: 'pointer' }} onClick={() => navigate(`/editor/${encodeURIComponent(f.relPath)}`)}>
              <td className="mono">{f.relPath}</td><td>{f.lang}</td>
              <td>{f.total.toLocaleString(locale)}</td><td>{f.code.toLocaleString(locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{t('top.largestFilesBySize')}</h2>
      <table>
        <thead><tr><th>{t('common.path')}</th><th>{t('common.lang')}</th><th>{t('common.size')}</th><th>{t('common.lines')}</th></tr></thead>
        <tbody>
          {largeFiles.map(f => (
            <tr key={f.relPath} style={{ cursor: 'pointer' }} onClick={() => navigate(`/editor/${encodeURIComponent(f.relPath)}`)}>
              <td className="mono">{f.relPath}</td><td>{f.lang}</td>
              <td>{(f.size / 1024).toFixed(1)} KB</td><td>{f.total.toLocaleString(locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{t('top.longestFunctions')}</h2>
      <table>
        <thead><tr><th>{t('common.file')}</th><th>{t('top.function')}</th><th>{t('top.start')}</th><th>{t('top.end')}</th><th>{t('top.length')}</th></tr></thead>
        <tbody>
          {funcs.map((f, i) => (
            <tr key={i} style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/editor/${encodeURIComponent(f.relPath)}?line=${f.startLine}`)}>
              <td className="mono">{f.relPath}</td>
              <td className="mono">{f.name}</td>
              <td>{f.startLine.toLocaleString(locale)}</td><td>{f.endLine.toLocaleString(locale)}</td><td>{f.length.toLocaleString(locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
