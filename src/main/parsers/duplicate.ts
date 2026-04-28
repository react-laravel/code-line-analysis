// Duplicate code detection: sliding window of N normalized lines, hashed.
// Reports occurrences sharing the same hash across files.

import { createHash } from 'node:crypto';

export interface DupSlice {
  hash: string;
  startLine: number;
  endLine: number;
}

const WINDOW = 6;
const MIN_NON_EMPTY_LINES = 4;
const MIN_SUBSTANTIVE_LINES = 2;

function normalize(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function isStructuralLine(line: string): boolean {
  if (line === '') return false;
  if (/^[{}()[\];,]+$/.test(line)) return true;
  if (/^<\/[A-Za-z][\w:.-]*>[;,.]?$/.test(line)) return true;
  return false;
}

function isSubstantiveLine(line: string): boolean {
  return line !== '' && !isStructuralLine(line);
}

export function findDuplicateSlices(content: string): DupSlice[] {
  const lines = content.split(/\r\n|\n|\r/).map(normalize);
  if (lines.length < WINDOW) return [];
  const out: DupSlice[] = [];
  for (let i = 0; i + WINDOW <= lines.length; i++) {
    const slice = lines.slice(i, i + WINDOW);
    if (slice.every(s => s === '')) continue;
    if (slice.filter(s => s !== '').length < MIN_NON_EMPTY_LINES) continue;
    if (slice.filter(isSubstantiveLine).length < MIN_SUBSTANTIVE_LINES) continue;
    const h = createHash('sha1').update(slice.join('\n')).digest('hex').slice(0, 16);
    out.push({ hash: h, startLine: i + 1, endLine: i + WINDOW });
  }
  return out;
}
