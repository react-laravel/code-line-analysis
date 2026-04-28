// Lightweight function detector — regex per language family. Heuristic only.
// Reports name, start line, end line (by brace depth or indent for Python).

export interface FoundFunction {
  name: string;
  startLine: number;
  endLine: number;
  length: number;
}

type Family = 'brace' | 'python' | 'none';

function familyFor(ext: string): Family {
  switch (ext) {
    case 'js': case 'jsx': case 'ts': case 'tsx': case 'mjs': case 'cjs':
    case 'c': case 'h': case 'cpp': case 'cc': case 'hpp':
    case 'java': case 'kt': case 'swift': case 'go': case 'rs':
    case 'cs': case 'scala': case 'php': case 'dart': case 'scss': case 'less':
      return 'brace';
    case 'py':
      return 'python';
    default:
      return 'none';
  }
}

const BRACE_RE_LIST: RegExp[] = [
  // function name(...) {
  /\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g,
  // name = function(...) {  OR const name = (...) => {
  /\b([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\s*)?\([^)]*\)\s*(?:=>\s*)?\{/g,
  // method(...) {  inside class — heuristic with leading whitespace
  /^\s{2,}(?:async\s+|public\s+|private\s+|protected\s+|static\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm,
  // Go: func Name(...) ... {
  /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\([^)]*\)[^{]*\{/g,
  // Rust: fn name(...) ... {
  /\bfn\s+([A-Za-z_][\w]*)\s*[<(][^{]*\{/g,
];

function findBraceFunctions(content: string): FoundFunction[] {
  const lines = content.split(/\r\n|\n|\r/);
  // Precompute index -> line number map
  const lineStart: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineStart.push(i + 1);
  }
  const lineOf = (idx: number): number => {
    let lo = 0, hi = lineStart.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStart[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };

  const out: FoundFunction[] = [];
  const seenStartLines = new Set<number>();

  for (const re of BRACE_RE_LIST) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const openIdx = content.indexOf('{', m.index + m[0].length - 1);
      const realOpen = m[0].endsWith('{') ? m.index + m[0].length - 1 : openIdx;
      if (realOpen < 0) continue;
      const startLine = lineOf(m.index);
      if (seenStartLines.has(startLine)) continue;

      // Walk to matching brace
      let depth = 1;
      let i = realOpen + 1;
      let inStr: string | null = null;
      let inLineComment = false;
      let inBlockComment = false;
      while (i < content.length && depth > 0) {
        const ch = content[i];
        const nx = content[i + 1];
        if (inLineComment) { if (ch === '\n') inLineComment = false; i++; continue; }
        if (inBlockComment) { if (ch === '*' && nx === '/') { inBlockComment = false; i += 2; continue; } i++; continue; }
        if (inStr) { if (ch === '\\') { i += 2; continue; } if (ch === inStr) inStr = null; i++; continue; }
        if (ch === '/' && nx === '/') { inLineComment = true; i += 2; continue; }
        if (ch === '/' && nx === '*') { inBlockComment = true; i += 2; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
      }
      const endLine = depth === 0 ? lineOf(i - 1) : lines.length;
      seenStartLines.add(startLine);
      out.push({
        name: m[1] || '<anonymous>',
        startLine,
        endLine,
        length: endLine - startLine + 1,
      });
    }
  }
  return out;
}

function findPythonFunctions(content: string): FoundFunction[] {
  const lines = content.split(/\r\n|\n|\r/);
  const out: FoundFunction[] = [];
  const defRe = /^(\s*)def\s+([A-Za-z_][\w]*)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const m = defRe.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const start = i + 1;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const ln = lines[j];
      if (ln.trim() === '') continue;
      const curIndent = ln.length - ln.trimStart().length;
      if (curIndent <= indent) { end = j; break; }
    }
    out.push({ name: m[2], startLine: start, endLine: end, length: end - start + 1 });
  }
  return out;
}

export function findFunctions(content: string, ext: string): FoundFunction[] {
  const fam = familyFor(ext);
  if (fam === 'brace') return findBraceFunctions(content);
  if (fam === 'python') return findPythonFunctions(content);
  return [];
}
