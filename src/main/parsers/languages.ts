// Language definitions: extension -> language id, with comment syntax.
// Inspired by cloc; minimal but covers common languages.

export interface LangDef {
  id: string;
  line: string[]; // line comment markers
  block: Array<[string, string]>; // [start, end]
  string?: Array<[string, string]>; // simple string delimiters to skip
}

const QUOTED_STRINGS: Array<[string, string]> = [['"', '"'], ["'", "'"]];

const C_LIKE: Pick<LangDef, 'line' | 'block' | 'string'> = {
  line: ['//'],
  block: [['/*', '*/']],
  string: [...QUOTED_STRINGS, ['`', '`']],
};

const WEB_COMPONENT: Pick<LangDef, 'line' | 'block' | 'string'> = {
  line: ['//'],
  block: [['<!--', '-->'], ['/*', '*/']],
  string: [...QUOTED_STRINGS, ['`', '`']],
};

export const LANGUAGES: Record<string, LangDef> = {
  ts: { id: 'TypeScript', ...C_LIKE },
  tsx: { id: 'TSX', ...C_LIKE },
  js: { id: 'JavaScript', ...C_LIKE },
  jsx: { id: 'JSX', ...C_LIKE },
  mjs: { id: 'JavaScript', ...C_LIKE },
  cjs: { id: 'JavaScript', ...C_LIKE },
  json: { id: 'JSON', line: [], block: [] },
  c: { id: 'C', ...C_LIKE },
  h: { id: 'C/C++ Header', ...C_LIKE },
  cpp: { id: 'C++', ...C_LIKE },
  cc: { id: 'C++', ...C_LIKE },
  hpp: { id: 'C++ Header', ...C_LIKE },
  java: { id: 'Java', ...C_LIKE },
  kt: { id: 'Kotlin', ...C_LIKE },
  swift: { id: 'Swift', ...C_LIKE },
  go: { id: 'Go', ...C_LIKE },
  rs: { id: 'Rust', ...C_LIKE },
  cs: { id: 'C#', ...C_LIKE },
  scala: { id: 'Scala', ...C_LIKE },
  php: { id: 'PHP', line: ['//', '#'], block: [['/*', '*/']], string: C_LIKE.string },
  py: { id: 'Python', line: ['#'], block: [['"""', '"""'], ["'''", "'''"]], string: QUOTED_STRINGS },
  rb: { id: 'Ruby', line: ['#'], block: [['=begin', '=end']], string: QUOTED_STRINGS },
  sh: { id: 'Shell', line: ['#'], block: [], string: QUOTED_STRINGS },
  bash: { id: 'Shell', line: ['#'], block: [], string: QUOTED_STRINGS },
  zsh: { id: 'Shell', line: ['#'], block: [], string: QUOTED_STRINGS },
  yml: { id: 'YAML', line: ['#'], block: [], string: QUOTED_STRINGS },
  yaml: { id: 'YAML', line: ['#'], block: [], string: QUOTED_STRINGS },
  toml: { id: 'TOML', line: ['#'], block: [], string: QUOTED_STRINGS },
  ini: { id: 'INI', line: [';', '#'], block: [], string: QUOTED_STRINGS },
  sql: { id: 'SQL', line: ['--'], block: [['/*', '*/']], string: QUOTED_STRINGS },
  html: { id: 'HTML', line: [], block: [['<!--', '-->']] },
  htm: { id: 'HTML', line: [], block: [['<!--', '-->']] },
  xml: { id: 'XML', line: [], block: [['<!--', '-->']] },
  css: { id: 'CSS', line: [], block: [['/*', '*/']] },
  scss: { id: 'SCSS', ...C_LIKE },
  less: { id: 'Less', ...C_LIKE },
  md: { id: 'Markdown', line: [], block: [] },
  vue: { id: 'Vue', ...WEB_COMPONENT },
  svelte: { id: 'Svelte', ...WEB_COMPONENT },
  lua: { id: 'Lua', line: ['--'], block: [['--[[', ']]']] },
  pl: { id: 'Perl', line: ['#'], block: [['=pod', '=cut']] },
  r: { id: 'R', line: ['#'], block: [] },
  dart: { id: 'Dart', ...C_LIKE },
  ex: { id: 'Elixir', line: ['#'], block: [] },
  exs: { id: 'Elixir', line: ['#'], block: [] },
  elm: { id: 'Elm', line: ['--'], block: [['{-', '-}']] },
  hs: { id: 'Haskell', line: ['--'], block: [['{-', '-}']] },
  clj: { id: 'Clojure', line: [';'], block: [] },
  vim: { id: 'Vim Script', line: ['"'], block: [] },
  dockerfile: { id: 'Dockerfile', line: ['#'], block: [] },
  makefile: { id: 'Makefile', line: ['#'], block: [] },
};

const SPECIAL_FILENAMES: Record<string, string> = {
  Dockerfile: 'dockerfile',
  Makefile: 'makefile',
  GNUmakefile: 'makefile',
};

export function detectLang(relPathOrName: string): { ext: string; lang: LangDef | null; langId: string } {
  const base = relPathOrName.split(/[\\/]/).pop() || relPathOrName;
  if (SPECIAL_FILENAMES[base]) {
    const k = SPECIAL_FILENAMES[base];
    return { ext: k, lang: LANGUAGES[k], langId: LANGUAGES[k].id };
  }
  const dot = base.lastIndexOf('.');
  if (dot < 0) return { ext: '', lang: null, langId: 'Other' };
  const ext = base.slice(dot + 1).toLowerCase();
  const lang = LANGUAGES[ext] || null;
  return { ext, lang, langId: lang ? lang.id : 'Other' };
}
