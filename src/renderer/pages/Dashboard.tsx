import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FolderRow, FolderStats, ScanProgress } from '../../shared/api';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, Legend } from 'recharts';
import { useI18n } from '../i18n';

const COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#a371f7', '#79c0ff', '#56d364', '#ffa657', '#ff7b72', '#d2a8ff'];
const TOOLTIP_STYLE = { background: '#161b22', border: '1px solid #2a313c', color: '#e6edf3' };
const TOOLTIP_TEXT_STYLE = { color: '#e6edf3' };

interface Props { folder: FolderRow | null; progress: ScanProgress | null; }

export default function Dashboard({ folder, progress }: Props) {
  const [stats, setStats] = useState<FolderStats | null>(null);
  const [scanning, setScanning] = useState(false);
  const navigate = useNavigate();
  const { locale, t } = useI18n();

  async function refresh() {
    if (!folder) return;
    try { setStats(await window.api.stats.summary(folder.id)); } catch { /* empty */ }
  }
  useEffect(() => { refresh(); }, [folder?.id]);
  useEffect(() => { if (progress?.phase === 'done') refresh(); }, [progress?.phase]);

  if (!folder) return (
    <div className="empty empty-action">
      <div>{t('dashboard.addOrSelectFolder')}</div>
      <button onClick={() => navigate('/')}>{t('nav.workspace')}</button>
    </div>
  );

  async function runScan(full: boolean) {
    setScanning(true);
    try { await window.api.scan.run(folder!.id, { full, detectDuplicates: true }); }
    finally { setScanning(false); refresh(); }
  }

  async function runAction(action: string) {
    if (!folder || action === '') return;
    if (action === 'full') await runScan(true);
    if (action === 'setBaseline') {
      await window.api.scan.initBaseline(folder.id);
      refresh();
    }
    if (action === 'resetBaseline') {
      await window.api.scan.resetBaseline(folder.id);
      refresh();
    }
  }

  return (
    <div>
      <h1>{folder.name}</h1>
      <div className="muted" style={{ marginBottom: 8 }}>{folder.rootPath}</div>
      <div className="toolbar">
        <button className="primary" disabled={scanning} onClick={() => runScan(false)}>{t('dashboard.scan')}</button>
        <select className="action-select" value="" disabled={scanning} onChange={e => runAction(e.target.value)}>
          <option value="">{t('dashboard.moreActions')}</option>
          <option value="full">{t('dashboard.fullRescan')}</option>
          <option value="setBaseline">{t('dashboard.setBaseline')}</option>
          <option value="resetBaseline">{t('dashboard.resetBaseline')}</option>
        </select>
      </div>

      {!stats ? <div className="empty">{t('dashboard.noData')}</div> : (
        <>
          <div className="cards">
            <div className="card"><div className="label">{t('common.files')}</div><div className="value">{stats.totalFiles.toLocaleString(locale)}</div></div>
            <div className="card">
              <div className="label">{t('dashboard.totalLines')}</div>
              <div className="value">{stats.totalLines.toLocaleString(locale)}</div>
              {folder.baselineAt != null && (
                <div className={stats.delta >= 0 ? 'delta-pos' : 'delta-neg'}>
                  {stats.delta >= 0 ? '+' : ''}{stats.delta.toLocaleString(locale)} {t('dashboard.sinceBaseline')}
                </div>
              )}
            </div>
            <div className="card"><div className="label">{t('common.code')}</div><div className="value">{stats.totalCode.toLocaleString(locale)}</div></div>
            <div className="card"><div className="label">{t('common.comments')}</div><div className="value">{stats.totalComment.toLocaleString(locale)}</div></div>
            <div className="card"><div className="label">{t('common.blank')}</div><div className="value">{stats.totalBlank.toLocaleString(locale)}</div></div>
            <div className="card"><div className="label">{t('dashboard.blockCommentLines')}</div><div className="value">{stats.totalBlockComment.toLocaleString(locale)}</div></div>
            {Object.entries(stats.tagCounts).map(([k, v]) => (
              <div className="card" key={k}>
                <div className="label">{k}</div>
                <div className="value">{v.toLocaleString(locale)}</div>
              </div>
            ))}
          </div>

          <h2>{t('dashboard.byLanguage')}</h2>
          <div className="chart-grid">
            <div className="chart-box">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={stats.byLang.slice(0, 10)}
                    dataKey="total"
                    nameKey="lang"
                    outerRadius={100}
                    activeShape={{ stroke: '#e6edf3', strokeWidth: 2 }}
                  >
                    {stats.byLang.slice(0, 10).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_TEXT_STYLE} labelStyle={TOOLTIP_TEXT_STYLE} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-box">
              <ResponsiveContainer>
                <BarChart data={stats.byLang.slice(0, 10)}>
                  <XAxis dataKey="lang" stroke="#8b949e" />
                  <YAxis stroke="#8b949e" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_TEXT_STYLE} labelStyle={TOOLTIP_TEXT_STYLE} />
                  <Bar dataKey="code" fill="#58a6ff" name={t('common.code')} />
                  <Bar dataKey="comment" fill="#d29922" name={t('common.comment')} />
                  <Bar dataKey="blank" fill="#8b949e" name={t('common.blank')} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <h2>{t('dashboard.languagesDetail')}</h2>
          <table>
            <thead><tr><th>{t('common.language')}</th><th>{t('common.files')}</th><th>{t('common.total')}</th><th>{t('common.code')}</th><th>{t('common.comment')}</th><th>{t('common.blank')}</th></tr></thead>
            <tbody>
              {stats.byLang.map(l => (
                <tr key={l.lang}>
                  <td>{l.lang}</td><td>{l.files.toLocaleString(locale)}</td><td>{l.total.toLocaleString(locale)}</td>
                  <td>{l.code.toLocaleString(locale)}</td><td>{l.comment.toLocaleString(locale)}</td><td>{l.blank.toLocaleString(locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
