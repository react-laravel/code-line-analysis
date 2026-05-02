import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FolderRow, FolderStats, ScanProgress } from '../../shared/api';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, Legend } from 'recharts';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import { useI18n } from '../i18n';

const COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#a371f7', '#79c0ff', '#56d364', '#ffa657', '#ff7b72', '#d2a8ff'];
const TOOLTIP_STYLE = { background: '#161b22', border: '1px solid #2a313c', color: '#e6edf3' };
const TOOLTIP_TEXT_STYLE = { color: '#e6edf3' };

interface Props { folder: FolderRow | null; progress: ScanProgress | null; }

export default function Dashboard({ folder, progress }: Props) {
  const [stats, setStats] = useState<FolderStats | null>(null);
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const annotationTotal = stats ? Object.values(stats.tagCounts).reduce((sum, count) => sum + count, 0) : 0;
  const annotationBreakdown = stats
    ? Object.entries(stats.tagCounts)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => `${kind} ${count.toLocaleString(locale)}`)
      .join(' · ')
    : '';

  async function refresh() {
    if (!folder) return;
    try { setStats(await window.api.stats.summary(folder.id)); } catch { /* empty */ }
  }
  useEffect(() => { refresh(); }, [folder?.id]);
  useEffect(() => { if (progress?.phase === 'done') refresh(); }, [progress?.phase]);

  if (!folder) return (
    <EmptyState
      title={t('dashboard.title')}
      description={t('dashboard.addOrSelectFolder')}
      action={(
      <button onClick={() => navigate('/')}>{t('nav.workspace')}</button>
      )}
    />
  );

  return (
    <div className="dashboard-page">
      <PageHeader
        eyebrow={t('nav.dashboard')}
        title={folder.name}
        description={folder.rootPath}
      />

      {!stats ? <EmptyState description={t('dashboard.noData')} /> : (
        <>
          <div className="cards dashboard-cards">
            <div className="card metric-card"><div className="label">{t('common.files')}</div><div className="value">{stats.totalFiles.toLocaleString(locale)}</div></div>
            <div className="card metric-card">
              <div className="label">{t('dashboard.totalLines')}</div>
              <div className="value">{stats.totalLines.toLocaleString(locale)}</div>
            </div>
            <div className="card metric-card"><div className="label">{t('dashboard.totalCode')}</div><div className="value">{stats.totalCode.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('dashboard.runtimeCode')}</div><div className="value">{stats.runtimeCode.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('dashboard.testCode')}</div><div className="value">{stats.testCode.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('common.comments')}</div><div className="value">{stats.totalComment.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('common.blank')}</div><div className="value">{stats.totalBlank.toLocaleString(locale)}</div></div>
            <div className="card metric-card"><div className="label">{t('dashboard.blockCommentLines')}</div><div className="value">{stats.totalBlockComment.toLocaleString(locale)}</div></div>
            <div className="card metric-card">
              <div className="label">{t('dashboard.annotations')}</div>
              <div className="value">{annotationTotal.toLocaleString(locale)}</div>
              {annotationBreakdown && <div className="metric-note">{annotationBreakdown}</div>}
            </div>
          </div>

          <h2 className="section-heading">{t('dashboard.byLanguage')}</h2>
          <div className="chart-grid dashboard-chart-grid">
            <div className="chart-box">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={stats.byLang.slice(0, 10)}
                    dataKey="total"
                    nameKey="lang"
                    outerRadius={92}
                    activeShape={{ stroke: '#e6edf3', strokeWidth: 2 }}
                  >
                    {stats.byLang.slice(0, 10).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_TEXT_STYLE} labelStyle={TOOLTIP_TEXT_STYLE} />
                  <Legend verticalAlign="bottom" align="left" wrapperStyle={{ paddingTop: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-box">
              <ResponsiveContainer>
                <BarChart data={stats.byLang.slice(0, 10)}>
                  <XAxis dataKey="lang" stroke="#8b949e" />
                  <YAxis stroke="#8b949e" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_TEXT_STYLE} labelStyle={TOOLTIP_TEXT_STYLE} cursor={false} />
                  <Bar dataKey="code" fill="#58a6ff" name={t('common.code')} />
                  <Bar dataKey="comment" fill="#d29922" name={t('common.comment')} />
                  <Bar dataKey="blank" fill="#8b949e" name={t('common.blank')} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <h2 className="section-heading">{t('dashboard.languagesDetail')}</h2>
          <div className="table-wrap">
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
          </div>
        </>
      )}
    </div>
  );
}
