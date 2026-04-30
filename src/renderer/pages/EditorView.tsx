import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import Editor, { OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { FolderRow, FileMeta, GitFileInfo, TagRow } from '../../shared/api';
import { useI18n } from '../i18n';

interface Props {
  folder: FolderRow | null;
  scanRevision: number;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  json: 'json', py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  cpp: 'cpp', cc: 'cpp', c: 'c', h: 'cpp', hpp: 'cpp', cs: 'csharp',
  rb: 'ruby', php: 'php', swift: 'swift', sh: 'shell', bash: 'shell',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', sql: 'sql',
  html: 'html', htm: 'html', xml: 'xml', css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', vue: 'html', svelte: 'html', dart: 'dart', lua: 'lua',
};

function langOf(relPath: string): string {
  const dot = relPath.lastIndexOf('.');
  if (dot < 0) return 'plaintext';
  return EXT_TO_LANG[relPath.slice(dot + 1).toLowerCase()] || 'plaintext';
}

export default function EditorView({ folder, scanRevision }: Props) {
  const { relPath = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const decodedPath = relPath;
  const targetLine = Number(searchParams.get('line')) || 0;
  const targetEndLine = Number(searchParams.get('endLine')) || 0;
  const highlightKind = searchParams.get('highlight');
  const currentFileKey = folder && decodedPath ? `${folder.id}:${decodedPath}` : '';

  const [content, setContent] = useState<string>('');
  const [original, setOriginal] = useState<string>('');
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [git, setGit] = useState<GitFileInfo | null>(null);
  const [fileTags, setFileTags] = useState<TagRow[]>([]);
  const [readOnly, setReadOnly] = useState(true);
  const [savingCountsByFile, setSavingCountsByFile] = useState<Record<string, number>>({});
  const [editorReady, setEditorReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedPath, setLoadedPath] = useState('');
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const activeFileKeyRef = useRef(currentFileKey);
  const lastFileKeyRef = useRef(currentFileKey);
  const fileVersionRef = useRef(0);
  activeFileKeyRef.current = currentFileKey;
  if (lastFileKeyRef.current !== currentFileKey) {
    lastFileKeyRef.current = currentFileKey;
    fileVersionRef.current += 1;
  }

  function isCurrentFileRequest(requestKey: string, requestVersion: number) {
    return activeFileKeyRef.current === requestKey && fileVersionRef.current === requestVersion;
  }

  function revealTargetLine(lineNumber: number, endLine?: number) {
    const mountedEditor = editorRef.current;
    if (!mountedEditor || lineNumber <= 0) return;
    const model = mountedEditor.getModel();
    if (!model) return;
    const safeLineNumber = Math.min(Math.max(lineNumber, 1), model.getLineCount() || 1);
    const safeEndLine = Math.min(Math.max(endLine ?? lineNumber, safeLineNumber), model.getLineCount() || 1);
    if (safeEndLine > safeLineNumber) {
      mountedEditor.revealLinesInCenter(safeLineNumber, safeEndLine);
      mountedEditor.setSelection({ startLineNumber: safeLineNumber, startColumn: 1, endLineNumber: safeEndLine, endColumn: model.getLineMaxColumn(safeEndLine) });
    } else {
      mountedEditor.revealLineInCenter(safeLineNumber);
      mountedEditor.setPosition({ lineNumber: safeLineNumber, column: 1 });
    }
    mountedEditor.focus();
  }

  function clearHighlights() {
    const mountedEditor = editorRef.current;
    if (!mountedEditor || decorationIdsRef.current.length === 0) return;
    decorationIdsRef.current = mountedEditor.deltaDecorations(decorationIdsRef.current, []);
  }

  function applyHighlights(startLine: number, endLine: number, kind: string | null) {
    const mountedEditor = editorRef.current;
    const monacoInstance = monacoRef.current;
    const model = mountedEditor?.getModel();
    if (!mountedEditor || !monacoInstance || !model || startLine <= 0) {
      clearHighlights();
      return;
    }

    const safeStart = Math.min(Math.max(startLine, 1), model.getLineCount() || 1);
    const safeEnd = Math.min(Math.max(endLine || startLine, safeStart), model.getLineCount() || 1);
    const tone = kind === 'duplicate' ? 'duplicate' : kind === 'function' ? 'function' : 'default';

    decorationIdsRef.current = mountedEditor.deltaDecorations(decorationIdsRef.current, [
      {
        range: new monacoInstance.Range(safeStart, 1, safeEnd, model.getLineMaxColumn(safeEnd)),
        options: {
          isWholeLine: true,
          className: `editor-highlight-range ${tone}`,
          linesDecorationsClassName: `editor-highlight-gutter ${tone}`,
        },
      },
      {
        range: new monacoInstance.Range(safeStart, 1, safeStart, model.getLineMaxColumn(safeStart)),
        options: {
          isWholeLine: true,
          className: `editor-highlight-anchor ${tone}`,
        },
      },
    ]);
  }

  function jumpToLine(lineNumber: number) {
    if (!decodedPath) return;
    navigate(`/editor/${encodeURIComponent(decodedPath)}?line=${lineNumber}`, { replace: true });
    revealTargetLine(lineNumber);
  }

  useEffect(() => {
    if (!folder || !decodedPath) return;
    const requestKey = currentFileKey;
    const requestVersion = fileVersionRef.current;
    setError(null);
    setMeta(null);
    setGit(null);
    setFileTags([]);
    setLoadedPath('');
    setContent('');
    setOriginal('');
    window.api.file.read(folder.id, decodedPath).then(({ content, meta }) => {
      if (!isCurrentFileRequest(requestKey, requestVersion)) return;
      setContent(content); setOriginal(content); setMeta(meta); setLoadedPath(decodedPath);
    }).catch(e => {
      if (!isCurrentFileRequest(requestKey, requestVersion)) return;
      setError(String(e));
    });
    window.api.git.fileInfo(folder.id, decodedPath).then((nextGit) => {
      if (!isCurrentFileRequest(requestKey, requestVersion)) return;
      setGit(nextGit);
    }).catch(() => {
      if (!isCurrentFileRequest(requestKey, requestVersion)) return;
      setGit(null);
    });
    window.api.stats.fileTags(folder.id, decodedPath).then((nextTags) => {
      if (!isCurrentFileRequest(requestKey, requestVersion)) return;
      setFileTags(nextTags);
    }).catch(() => {
      if (!isCurrentFileRequest(requestKey, requestVersion)) return;
      setFileTags([]);
    });
  }, [currentFileKey, decodedPath, folder?.id]);

  useEffect(() => {
    if (!folder || !decodedPath || scanRevision === 0) return;
    const requestKey = currentFileKey;
    const requestVersion = fileVersionRef.current;
    window.api.stats.fileTags(folder.id, decodedPath).then((nextTags) => {
      if (!isCurrentFileRequest(requestKey, requestVersion)) return;
      setFileTags(nextTags);
    }).catch(() => {
      if (!isCurrentFileRequest(requestKey, requestVersion)) return;
      setFileTags([]);
    });
  }, [currentFileKey, decodedPath, folder?.id, scanRevision]);

  useEffect(() => {
    if (!editorReady || loadedPath !== decodedPath) return;
    if (targetLine <= 0) {
      clearHighlights();
      return;
    }
    applyHighlights(targetLine, targetEndLine, highlightKind);
    revealTargetLine(targetLine, targetEndLine);
  }, [decodedPath, editorReady, highlightKind, loadedPath, targetEndLine, targetLine]);

  useEffect(() => clearHighlights, []);

  const onMount: OnMount = (mountedEditor, monacoInstance) => {
    editorRef.current = mountedEditor;
    monacoRef.current = monacoInstance;
    setEditorReady(true);
  };

  function beforeMount(monacoInstance: typeof import('monaco-editor')) {
    monacoInstance.editor.setTheme('vs-dark');
  }

  async function save() {
    if (!folder) return;
    const requestKey = currentFileKey;
    const requestVersion = fileVersionRef.current;
    setSavingCountsByFile(current => ({
      ...current,
      [requestKey]: (current[requestKey] ?? 0) + 1,
    }));
    try {
      const newMeta = await window.api.file.write(folder.id, decodedPath, content);
      if (!isCurrentFileRequest(requestKey, requestVersion)) return;
      const nextTags = await window.api.stats.fileTags(folder.id, decodedPath);
      if (!isCurrentFileRequest(requestKey, requestVersion)) return;
      setMeta(newMeta);
      setOriginal(content);
      setFileTags(nextTags);
    } catch (e) {
      if (!isCurrentFileRequest(requestKey, requestVersion)) return;
      setError(String(e));
    } finally {
      setSavingCountsByFile(current => {
        const nextCount = (current[requestKey] ?? 0) - 1;
        if (nextCount > 0) {
          return { ...current, [requestKey]: nextCount };
        }
        const { [requestKey]: _removed, ...rest } = current;
        return rest;
      });
    }
  }

  if (!folder) return <div className="empty">{t('common.selectFolder')}</div>;
  const saving = (savingCountsByFile[currentFileKey] ?? 0) > 0;
  const dirty = content !== original;
  const groupedFileTags = Array.from(fileTags.reduce<Map<TagRow['kind'], TagRow[]>>((groups, tag) => {
    const currentGroup = groups.get(tag.kind) ?? [];
    currentGroup.push(tag);
    groups.set(tag.kind, currentGroup);
    return groups;
  }, new Map()));

  return (
    <div className="editor-page">
      <div className="toolbar">
        <button onClick={() => navigate(-1)}>← {t('editor.back')}</button>
        <strong className="mono">{decodedPath}</strong>
        {meta && <span className="muted editor-toolbar-meta">
          {meta.lang} · {meta.total.toLocaleString(locale)} {t('common.lines')} · {(meta.size/1024).toFixed(1)} KB · {t('editor.mtime')} {new Date(meta.mtime).toLocaleString(locale)}
        </span>}
        <span style={{ flex: 1 }} />
        <label><input type="checkbox" checked={!readOnly} onChange={e => setReadOnly(!e.target.checked)} /> {t('editor.editMode')}</label>
        <button className="primary" disabled={readOnly || !dirty || saving} onClick={save}>{saving ? t('editor.saving') : t('editor.save')}</button>
      </div>
      {error && <div className="card" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>{error}</div>}
      {!error && !editorReady && meta && (
        <div className="card" style={{ marginBottom: 8 }}>
          {t('editor.monacoLoading')}
        </div>
      )}
      {git && (
        <div className="muted" style={{ marginBottom: 8 }}>
          {t('editor.git')}: {git.lastSha?.slice(0, 7) || '—'} {t('editor.gitBy')} {git.lastAuthor || '—'} {t('editor.gitOn')} {git.lastDate ? new Date(git.lastDate).toLocaleDateString(locale) : '—'}
          {git.topAuthors.length > 0 && <> · {t('editor.gitTop')}: {git.topAuthors.map(a => `${a.author} (${a.lines.toLocaleString(locale)})`).join(', ')}</>}
        </div>
      )}
      {groupedFileTags.length > 0 && (
        <div className="toolbar editor-tag-toolbar">
          <span className="muted">{t('tags.title')}</span>
          {groupedFileTags.map(([currentKind, hits]) => (
            <div key={currentKind} className="editor-tag-group">
              <span className={`tag-pill tag-${currentKind}`}>{currentKind}</span>
              <div className="tag-jump-list">
                {hits.map((hit, index) => (
                  <button
                    key={`${currentKind}-${hit.lineNo}-${index}`}
                    className="tag-jump-button"
                    title={t('tags.jumpToLine', { line: hit.lineNo.toLocaleString(locale) })}
                    onClick={() => jumpToLine(hit.lineNo)}
                  >
                    {hit.lineNo.toLocaleString(locale)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="editor-host">
        <Editor
          height="100%"
          theme="vs-dark"
          path={decodedPath}
          language={langOf(decodedPath)}
          loading={t('editor.loadingAssets')}
          value={content}
          onChange={v => setContent(v ?? '')}
          beforeMount={beforeMount}
          onMount={onMount}
          options={{
            readOnly,
            glyphMargin: true,
            minimap: { enabled: true },
            fontSize: 13,
            wordWrap: 'on',
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}
