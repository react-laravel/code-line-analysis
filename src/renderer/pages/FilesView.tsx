import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FolderRow, TopFile } from '../../shared/api';
import PageHeader from '../components/PageHeader';
import { useI18n } from '../i18n';

interface Props {
  folder: FolderRow | null;
  scanRevision: number;
}

type SortKey = 'relPath' | 'total' | 'code' | 'size' | 'lang' | 'ext';

const NO_EXTENSION = '(none)';

interface FileRowView extends TopFile {
  ext: string;
}

function extOf(relPath: string): string {
  const base = relPath.split('/').pop() || relPath;
  const dot = base.lastIndexOf('.');
  return dot < 0 ? NO_EXTENSION : base.slice(dot + 1).toLowerCase();
}

export default function FilesView({ folder, scanRevision }: Props) {
  const [files, setFiles] = useState<TopFile[]>([]);
  const [q, setQ] = useState('');
  const [languageFilter, setLanguageFilter] = useState('ALL');
  const [extensionFilter, setExtensionFilter] = useState('ALL');
  const [minLines, setMinLines] = useState('');
  const [maxLines, setMaxLines] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [asc, setAsc] = useState(false);
  const navigate = useNavigate();
  const { locale, t } = useI18n();

  useEffect(() => {
    if (!folder) return;
    window.api.stats.topFiles(folder.id, 5000).then(setFiles);
  }, [folder?.id, scanRevision]);

  const rows = useMemo<FileRowView[]>(() => files.map(f => ({ ...f, ext: extOf(f.relPath) })), [files]);

  const languages = useMemo(
    () => Array.from(new Set(rows.map(f => f.lang))).sort((a, b) => a.localeCompare(b, locale)),
    [locale, rows],
  );

  const extensions = useMemo(
    () => Array.from(new Set(rows.map(f => f.ext))).sort((a, b) => a.localeCompare(b, locale)),
    [locale, rows],
  );

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    const min = minLines.trim() === '' ? null : Number(minLines);
    const max = maxLines.trim() === '' ? null : Number(maxLines);

    const arr = rows.filter(f => {
      if (ql && !f.relPath.toLowerCase().includes(ql) && !f.lang.toLowerCase().includes(ql) && !f.ext.toLowerCase().includes(ql)) {
        return false;
      }
      if (languageFilter !== 'ALL' && f.lang !== languageFilter) return false;
      if (extensionFilter !== 'ALL' && f.ext !== extensionFilter) return false;
      if (min != null && !Number.isNaN(min) && f.total < min) return false;
      if (max != null && !Number.isNaN(max) && f.total > max) return false;
      return true;
    });

    arr.sort((a, b) => {
      const va: any = a[sortKey], vb: any = b[sortKey];
      if (typeof va === 'string') return asc ? va.localeCompare(vb, locale) : vb.localeCompare(va, locale);
      return asc ? va - vb : vb - va;
    });
    return arr;
  }, [rows, q, languageFilter, extensionFilter, minLines, maxLines, sortKey, asc, locale]);

  const activeFilterCount = [q, languageFilter !== 'ALL' ? languageFilter : '', extensionFilter !== 'ALL' ? extensionFilter : '', minLines, maxLines]
    .filter(value => value !== '').length;
  const activeFilterLabel = activeFilterCount > 0
    ? t('files.activeFilters', { count: activeFilterCount.toLocaleString(locale) })
    : t('files.noFilters');

  function clearFilters() {
    setQ('');
    setLanguageFilter('ALL');
    setExtensionFilter('ALL');
    setMinLines('');
    setMaxLines('');
  }

  function openFile(relPath: string) {
    navigate(`/editor/${encodeURIComponent(relPath)}`);
  }

  function handleRowKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>, relPath: string) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openFile(relPath);
  }

  function header(k: SortKey, label: string) {
    return (
      <th>
        <button className="table-sort-button" onClick={() => { if (sortKey === k) setAsc(!asc); else { setSortKey(k); setAsc(false); } }}>
          {label} {sortKey === k ? (asc ? '↑' : '↓') : ''}
        </button>
      </th>
    );
  }

  if (!folder) return <div className="empty">{t('common.selectFolder')}</div>;

  return (
    <div>
      <PageHeader
        title={t('files.title')}
        description={t('files.subtitle')}
        meta={t('files.count', { shown: filtered.length.toLocaleString(locale), total: rows.length.toLocaleString(locale) })}
      />
      <div className="filter-panel">
        <div className="filter-panel-header">
          <strong>{t('common.filters')}</strong>
          <span className="status-pill">{activeFilterLabel}</span>
        </div>
        <div className="toolbar filter-toolbar">
        <input
          placeholder={t('files.searchPlaceholder')}
          value={q}
          onChange={e => setQ(e.target.value)}
          className="file-search-input"
        />
        <select value={languageFilter} onChange={e => setLanguageFilter(e.target.value)}>
          <option value="ALL">{t('files.allLanguages')}</option>
          {languages.map(lang => <option key={lang} value={lang}>{lang}</option>)}
        </select>
        <select value={extensionFilter} onChange={e => setExtensionFilter(e.target.value)}>
          <option value="ALL">{t('files.allExtensions')}</option>
          {extensions.map(ext => <option key={ext} value={ext}>{ext === NO_EXTENSION ? t('files.noExtension') : ext}</option>)}
        </select>
        <input
          type="number"
          min={0}
          placeholder={t('files.minLines')}
          value={minLines}
          onChange={e => setMinLines(e.target.value)}
          className="line-filter-input"
        />
        <input
          type="number"
          min={0}
          placeholder={t('files.maxLines')}
          value={maxLines}
          onChange={e => setMaxLines(e.target.value)}
          className="line-filter-input"
        />
        <button onClick={clearFilters} disabled={activeFilterCount === 0}>{t('files.clearFilters')}</button>
        </div>
      </div>
      <div className="table-wrap">
      <table>
        <thead><tr>
          {header('relPath', t('common.path'))}
          {header('lang', t('common.lang'))}
          {header('ext', t('files.ext'))}
          {header('total', t('common.lines'))}
          {header('code', t('common.code'))}
          {header('size', t('common.size'))}
        </tr></thead>
        <tbody>
          {filtered.slice(0, 1000).map(f => (
            <tr
              key={f.relPath}
              className="clickable-row"
              role="button"
              tabIndex={0}
              onClick={() => openFile(f.relPath)}
              onKeyDown={event => handleRowKeyDown(event, f.relPath)}
            >
              <td className="mono">{f.relPath}</td>
              <td>{f.lang}</td>
              <td className="mono">{f.ext === NO_EXTENSION ? t('files.noExtension') : f.ext}</td>
              <td>{f.total.toLocaleString(locale)}</td>
              <td>{f.code.toLocaleString(locale)}</td>
              <td>{(f.size / 1024).toFixed(1)} KB</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {filtered.length > 1000 && <div className="muted" style={{ marginTop: 8 }}>{t('files.showingFirst', { count: filtered.length.toLocaleString(locale) })}</div>}
    </div>
  );
}
