import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FolderRow, TagRow } from '../../shared/api';
import { useI18n } from '../i18n';
import PageHeader from '../components/PageHeader';

interface Props {
  folder: FolderRow | null;
  scanRevision: number;
}

interface TagWithPath extends TagRow {
  relPath: string;
}

interface GroupedTagFile {
  relPath: string;
  hits: TagWithPath[];
  kinds: TagRow['kind'][];
}

const KINDS = ['', 'TODO', 'FIXME', 'HACK', 'NOTE', 'XXX'];

export default function TagsView({ folder, scanRevision }: Props) {
  const [kind, setKind] = useState('');
  const [tags, setTags] = useState<TagWithPath[]>([]);
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const currentTagsKey = folder ? `${folder.id}:${kind}` : '';
  const activeTagsKeyRef = useRef(currentTagsKey);
  const lastTagsKeyRef = useRef(currentTagsKey);
  const tagsVersionRef = useRef(0);
  activeTagsKeyRef.current = currentTagsKey;
  if (lastTagsKeyRef.current !== currentTagsKey) {
    lastTagsKeyRef.current = currentTagsKey;
    tagsVersionRef.current += 1;
  }

  function isCurrentTagsRequest(requestKey: string, requestVersion: number) {
    return activeTagsKeyRef.current === requestKey && tagsVersionRef.current === requestVersion;
  }

  function openTag(relPath: string, lineNo: number) {
    navigate(`/editor/${encodeURIComponent(relPath)}?line=${lineNo}`);
  }

  useEffect(() => {
    if (!folder) {
      setTags([]);
      return;
    }
    const requestKey = currentTagsKey;
    const requestVersion = tagsVersionRef.current;
    setTags([]);
    window.api.stats.tags(folder.id, kind || undefined).then(nextTags => {
      if (!isCurrentTagsRequest(requestKey, requestVersion)) return;
      setTags(nextTags);
    });
  }, [currentTagsKey, folder?.id, kind, scanRevision]);

  if (!folder) return <div className="empty">{t('common.selectFolder')}</div>;

  const limitedTags = tags.slice(0, 1000);
  const groupedTags: GroupedTagFile[] = [];
  const groupedTagsByPath = new Map<string, GroupedTagFile>();

  for (const tag of limitedTags) {
    const currentGroup = groupedTagsByPath.get(tag.relPath);
    if (currentGroup) {
      currentGroup.hits.push(tag);
      if (!currentGroup.kinds.includes(tag.kind)) currentGroup.kinds.push(tag.kind);
      continue;
    }

    const nextGroup: GroupedTagFile = {
      relPath: tag.relPath,
      hits: [tag],
      kinds: [tag.kind],
    };

    groupedTagsByPath.set(tag.relPath, nextGroup);
    groupedTags.push(nextGroup);
  }

  return (
    <div className="tags-page">
      <PageHeader
        title={t('tags.title')}
        description={t('tags.subtitle')}
        meta={t('tags.count', { tags: limitedTags.length.toLocaleString(locale), files: groupedTags.length.toLocaleString(locale) })}
        actions={(
          <label className="page-select-field">
            <span>{t('common.kind')}</span>
            <select value={kind} onChange={e => setKind(e.target.value)}>
              {KINDS.map(k => <option key={k} value={k}>{k || t('common.all')}</option>)}
            </select>
          </label>
        )}
      />
      <div className="table-wrap">
        <table>
          <thead><tr><th>{t('common.kind')}</th><th>{t('common.file')}</th><th>{t('common.lines')}</th><th>{t('tags.jump')}</th><th>{t('common.text')}</th></tr></thead>
          <tbody>
            {groupedTags.map(group => (
              <tr key={group.relPath}>
                <td>
                  {group.kinds.map(currentKind => (
                    <span key={`${group.relPath}-${currentKind}`} className={`tag-pill tag-${currentKind}`}>{currentKind}</span>
                  ))}
                </td>
                <td>
                  <button className="tag-file-button mono" onClick={() => openTag(group.relPath, group.hits[0].lineNo)}>
                    {group.relPath}
                  </button>
                </td>
                <td className="mono">{group.hits.map(hit => hit.lineNo.toLocaleString(locale)).join(', ')}</td>
                <td>
                  <div className="tag-jump-list">
                    {group.hits.map((hit, index) => (
                      <button
                        key={`${group.relPath}-${hit.lineNo}-${index}`}
                        className="tag-jump-button"
                        title={t('tags.jumpToLine', { line: hit.lineNo.toLocaleString(locale) })}
                        onClick={() => openTag(group.relPath, hit.lineNo)}
                      >
                        {(index + 1).toLocaleString(locale)}
                      </button>
                    ))}
                  </div>
                </td>
                <td className="mono">{group.hits[0].text}{group.hits.length > 1 ? ` (+${group.hits.length - 1})` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
