import type { GitFileInfo } from '../../../shared/api';
import { useI18n } from '../../i18n';

interface Props {
  git: GitFileInfo | null;
  cursor: { line: number; column: number };
}

export default function EditorStatusBar({ git, cursor }: Props) {
  const { locale, t } = useI18n();

  return (
    <footer className="flex h-statusbar shrink-0 items-center gap-3 border-t border-border bg-surface px-2 text-2xs text-fg-muted">
      <span className="min-w-0 flex-1 truncate">
        {git ? (
          <>
            {t('editor.git')} {git.lastSha?.slice(0, 7) || '—'} {t('editor.gitBy')} {git.lastAuthor || '—'} {t('editor.gitOn')} {git.lastDate ? new Date(git.lastDate).toLocaleDateString(locale) : '—'}
            {git.topAuthors.length > 0
              ? ` · ${t('editor.gitCommittedAuthors')}: ${git.topAuthors.map(author => `${author.author} (${author.lines.toLocaleString(locale)})`).join(', ')}`
              : null}
          </>
        ) : null}
      </span>
      <span className="shrink-0 font-mono">
        {t('editor.cursor', {
          line: cursor.line.toLocaleString(locale),
          column: cursor.column.toLocaleString(locale),
        })}
      </span>
    </footer>
  );
}
