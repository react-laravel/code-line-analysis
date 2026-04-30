// Duplicate code detection: sliding window of N normalized lines, hashed.
// Reports occurrences sharing the same hash across files.

import { createHash } from 'node:crypto';
import { DEFAULT_DUPLICATE_LINES } from '../../shared/api';

export interface DupSlice {
  hash: string;
  startLine: number;
  endLine: number;
}

const MIN_SUBSTANTIVE_LINES = 2;

function normalize(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function stripJsxTags(line: string): string {
  return line
    .replace(/<>|<\/>/g, '')
    .replace(/<\/?[A-Za-z][\w.:\-]*(?:\s+[^<>]*)?\/?\s*>/g, '');
}

function isStructuralLine(line: string): boolean {
  if (line === '') return true;
  if (/^[{}()[\];,]+$/.test(line)) return true;
  if (/^return\s*[({[]$/.test(line)) return true;
  const withoutJsx = stripJsxTags(line).replace(/[{}()[\];,]/g, '').trim();
  if (withoutJsx === '') return true;
  return false;
}

function isSubstantiveLine(line: string): boolean {
  return line !== '' && !isStructuralLine(line);
}

export function findDuplicateSlices(content: string, windowSize = DEFAULT_DUPLICATE_LINES): DupSlice[] {
  const normalizedWindowSize = Math.max(3, Math.floor(windowSize));
  const lines = content.split(/\r\n|\n|\r/).map(normalize);
  const substantiveLineIndexes = lines
    .map((line, index) => (isSubstantiveLine(line) ? index : -1))
    .filter(index => index >= 0);
  if (substantiveLineIndexes.length < normalizedWindowSize) return [];
  const out: DupSlice[] = [];
  for (let i = 0; i + normalizedWindowSize <= substantiveLineIndexes.length; i++) {
    const windowIndexes = substantiveLineIndexes.slice(i, i + normalizedWindowSize);
    const startIndex = windowIndexes[0];
    const endIndex = windowIndexes[windowIndexes.length - 1];
    const slice = lines.slice(startIndex, endIndex + 1);
    const substantiveSlice = slice.filter(isSubstantiveLine);
    if (substantiveSlice.length < Math.max(MIN_SUBSTANTIVE_LINES, normalizedWindowSize)) continue;
    const h = createHash('sha1').update(substantiveSlice.join('\n')).digest('hex').slice(0, 16);
    out.push({ hash: h, startLine: startIndex + 1, endLine: endIndex + 1 });
  }
  return out;
}
