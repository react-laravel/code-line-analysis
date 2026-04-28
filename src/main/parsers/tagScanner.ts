import type { LangDef } from './languages';

// Tag scanner: finds TODO/FIXME/HACK/NOTE/XXX inside line/block comments.
// It reuses language comment/string markers so plain strings do not count.

export interface FoundTag {
  kind: 'TODO' | 'FIXME' | 'HACK' | 'NOTE' | 'XXX';
  lineNo: number; // 1-based
  text: string;
}

const TAG_RE = /\b(TODO|FIXME|HACK|NOTE|XXX)\b[ \t:\-]*([^\r\n]*)/g;
const NEWLINE = /\r\n|\n|\r/;

function findStringEnd(raw: string, start: number, marker: string): number {
  let cursor = raw.indexOf(marker, start);
  while (cursor >= 0) {
    let backslashes = 0;
    for (let index = cursor - 1; index >= start && raw[index] === '\\'; index -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) return cursor;
    cursor = raw.indexOf(marker, cursor + marker.length);
  }
  return -1;
}

function pushMatches(out: FoundTag[], text: string, lineNo: number): void {
  if (!text.trim()) return;
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(text)) !== null) {
    out.push({
      kind: match[1] as FoundTag['kind'],
      lineNo,
      text: match[2].trim().slice(0, 240),
    });
  }
}

export function scanTags(content: string, lang: LangDef | null): FoundTag[] {
  const out: FoundTag[] = [];
  if (!lang) return out;

  const lines = content.split(NEWLINE);
  let inBlock: [string, string] | null = null;
  const lineMarkers = lang.line;
  const blocks = lang.block;
  const strings = lang.string ?? [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const raw = lines[lineIndex];
    const lineNo = lineIndex + 1;
    let index = 0;
    let inString: [string, string] | null = null;
    const commentParts: string[] = [];

    while (index < raw.length) {
      if (inBlock) {
        const endIndex = raw.indexOf(inBlock[1], index);
        if (endIndex < 0) {
          commentParts.push(raw.slice(index));
          index = raw.length;
        } else {
          commentParts.push(raw.slice(index, endIndex));
          index = endIndex + inBlock[1].length;
          inBlock = null;
        }
        continue;
      }

      if (inString) {
        const endIndex = findStringEnd(raw, index, inString[1]);
        if (endIndex < 0) {
          index = raw.length;
        } else {
          index = endIndex + inString[1].length;
          inString = null;
        }
        continue;
      }

      let matched = false;
      for (const marker of lineMarkers) {
        if (!raw.startsWith(marker, index)) continue;
        commentParts.push(raw.slice(index + marker.length));
        index = raw.length;
        matched = true;
        break;
      }
      if (matched) break;

      for (const block of blocks) {
        if (!raw.startsWith(block[0], index)) continue;
        const commentStart = index + block[0].length;
        const endIndex = raw.indexOf(block[1], commentStart);
        if (endIndex < 0) {
          commentParts.push(raw.slice(commentStart));
          index = raw.length;
          inBlock = block;
        } else {
          commentParts.push(raw.slice(commentStart, endIndex));
          index = endIndex + block[1].length;
        }
        matched = true;
        break;
      }
      if (matched) continue;

      for (const stringMarker of strings) {
        if (!raw.startsWith(stringMarker[0], index)) continue;
        index += stringMarker[0].length;
        inString = stringMarker;
        matched = true;
        break;
      }
      if (matched) continue;

      index += 1;
    }

    for (const commentPart of commentParts) {
      pushMatches(out, commentPart, lineNo);
    }
  }

  return out;
}
