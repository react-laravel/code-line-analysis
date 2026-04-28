import type { LangDef } from './languages';

export interface LineCounts {
  total: number;
  code: number;
  comment: number; // line comments only
  blank: number;
  blockComment: number;
}

const NEWLINE = /\r\n|\n|\r/;

// Parse counts using a small state machine: tracks block-comment state and
// strings (so // inside a string doesn't count as comment).
export function countLines(content: string, lang: LangDef | null): LineCounts {
  const lines = content.split(NEWLINE);
  // Drop trailing empty line caused by final newline (cloc behavior optional;
  // we keep all to mirror file shape).
  const counts: LineCounts = { total: lines.length, code: 0, comment: 0, blank: 0, blockComment: 0 };

  if (!lang) {
    for (const ln of lines) {
      if (ln.trim() === '') counts.blank++;
      else counts.code++;
    }
    return counts;
  }

  let inBlock: [string, string] | null = null;
  const lineMarkers = lang.line;
  const blocks = lang.block;
  const strings = lang.string ?? [];

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === '' && !inBlock) {
      counts.blank++;
      continue;
    }

    let i = 0;
    let sawCode = false;
    let sawComment = false;
    let sawBlockComment = false;
    let inString: [string, string] | null = null;

    while (i < raw.length) {
      // Inside block comment: scan to end marker.
      if (inBlock) {
        sawBlockComment = true;
        const end = raw.indexOf(inBlock[1], i);
        if (end < 0) {
          i = raw.length;
        } else {
          i = end + inBlock[1].length;
          inBlock = null;
        }
        continue;
      }

      // Inside string: scan to end (no escape handling — good enough for LOC).
      if (inString) {
        const end = raw.indexOf(inString[1], i);
        if (end < 0) {
          i = raw.length;
        } else {
          // skip escaped quotes simply: re-search past odd backslash count
          let cursor = end;
          while (cursor > i && raw[cursor - 1] === '\\') {
            // count backslashes
            let bs = 0;
            let k = cursor - 1;
            while (k >= i && raw[k] === '\\') { bs++; k--; }
            if (bs % 2 === 0) break;
            const next = raw.indexOf(inString[1], cursor + 1);
            if (next < 0) { cursor = -1; break; }
            cursor = next;
          }
          if (cursor < 0) { i = raw.length; }
          else { i = cursor + inString[1].length; inString = null; }
        }
        continue;
      }

      const ch = raw[i];
      if (ch === ' ' || ch === '\t') { i++; continue; }

      // Try line comment
      let matched = false;
      for (const m of lineMarkers) {
        if (raw.startsWith(m, i)) {
          sawComment = true;
          i = raw.length;
          matched = true;
          break;
        }
      }
      if (matched) break;

      // Try block comment start
      for (const b of blocks) {
        if (raw.startsWith(b[0], i)) {
          inBlock = b;
          sawBlockComment = true;
          i += b[0].length;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // Try string start
      for (const s of strings) {
        if (raw.startsWith(s[0], i)) {
          sawCode = true;
          inString = s;
          i += s[0].length;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      sawCode = true;
      i++;
    }

    if (sawCode) counts.code++;
    else if (sawComment || sawBlockComment) counts.comment++;
    else counts.blank++;

    if (sawBlockComment) counts.blockComment++;
  }

  return counts;
}
