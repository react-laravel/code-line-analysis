import { useMemo } from 'react';
import { Code2, Columns2, Eye, FileCode2 } from 'lucide-react';
import type { FileMeta, TagRow } from '../../../shared/api';
import { Badge, Button, Kbd, Switch, Tabs, Toolbar, type MenuItem } from '../../components/ui';
import type { MarkdownMode } from '../../store/tabs-store';
import { useI18n } from '../../i18n';
import { splitRelPath } from '../../lib/path';
import { tagTone } from '../../lib/tag-tone';

interface Props {
  relPath: string;
  meta: FileMeta | null;
  tags: TagRow[];
  readOnly: boolean;
  dirty: boolean;
  saving: boolean;
  overflow: MenuItem[];
  onReadOnlyChange: (readOnly: boolean) => void;
  onSave: () => void;
  onJumpToLine: (line: number) => void;
  markdownMode?: MarkdownMode;
  onMarkdownModeChange?: (mode: MarkdownMode) => void;
}

export default function EditorDocumentToolbar({
  relPath,
  meta,
  tags,
  readOnly,
  dirty,
  saving,
  overflow,
  onReadOnlyChange,
  onSave,
  onJumpToLine,
  markdownMode,
  onMarkdownModeChange,
}: Props) {
  const { locale, t } = useI18n();
  const groupedTags = useMemo(
    () => Array.from(tags.reduce<Map<TagRow['kind'], TagRow[]>>((groups, tag) => {
      const current = groups.get(tag.kind) ?? [];
      current.push(tag);
      groups.set(tag.kind, current);
      return groups;
    }, new Map())),
    [tags],
  );

  const { dir, name } = splitRelPath(relPath);
  const metaLine = meta
    ? `${meta.lang} · ${meta.total.toLocaleString(locale)} ${t('common.lines')} · ${(meta.size / 1024).toFixed(1)} KB · ${t('editor.mtime')} ${new Date(meta.mtime).toLocaleString(locale)}`
    : undefined;
  const subtitle = [dir || null, metaLine].filter(Boolean).join(' · ') || undefined;

  return (
    <Toolbar
      sticky={false}
      icon={FileCode2}
      title={<span className="font-mono" title={relPath}>{name}</span>}
      subtitle={subtitle}
      overflowLabel={t('common.more')}
      overflow={overflow}
      actions={(
        <>
          {markdownMode && onMarkdownModeChange ? (
            <Tabs
              variant="pill"
              size="sm"
              aria-label={t('editor.markdownDisplay')}
              value={markdownMode}
              onValueChange={value => onMarkdownModeChange(value as MarkdownMode)}
              items={[
                { value: 'source', label: t('editor.markdownSource'), icon: Code2 },
                { value: 'preview', label: t('editor.markdownPreview'), icon: Eye },
                { value: 'split', label: t('editor.markdownSplit'), icon: Columns2 },
              ]}
            />
          ) : null}
          <Switch
            size="sm"
            checked={!readOnly}
            onCheckedChange={next => onReadOnlyChange(!next)}
            label={t('editor.editMode')}
          />
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            disabled={readOnly || !dirty || saving}
            onClick={onSave}
          >
            {saving ? t('editor.saving') : t('editor.save')}
            <Kbd className="ml-0.5">Mod+S</Kbd>
          </Button>
        </>
      )}
      filters={groupedTags.length > 0 ? (
        <>
          <span className="text-xs text-fg-muted">{t('tags.title')}</span>
          {groupedTags.map(([kind, hits]) => (
            <div key={kind} className="flex flex-wrap items-center gap-1">
              <Badge tone={tagTone(kind)}>{kind} {hits.length}</Badge>
              {hits.map((hit, index) => (
                <Button
                  key={`${kind}-${hit.lineNo}-${index}`}
                  size="xs"
                  variant="ghost"
                  title={t('tags.jumpToLine', { line: hit.lineNo.toLocaleString(locale) })}
                  onClick={() => onJumpToLine(hit.lineNo)}
                >
                  {hit.lineNo.toLocaleString(locale)}
                </Button>
              ))}
            </div>
          ))}
        </>
      ) : undefined}
    />
  );
}
