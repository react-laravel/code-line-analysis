const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  cpp: 'cpp',
  cc: 'cpp',
  c: 'c',
  h: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  sh: 'shell',
  bash: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  mdown: 'markdown',
  mkd: 'markdown',
  vue: 'html',
  svelte: 'html',
  dart: 'dart',
  lua: 'lua',
};

export function editorLanguageForPath(relPath: string): string {
  const dot = relPath.lastIndexOf('.');
  if (dot < 0) return 'plaintext';
  return EXTENSION_LANGUAGE[relPath.slice(dot + 1).toLowerCase()] ?? 'plaintext';
}

export function isMarkdownPath(relPath: string): boolean {
  return editorLanguageForPath(relPath) === 'markdown';
}
