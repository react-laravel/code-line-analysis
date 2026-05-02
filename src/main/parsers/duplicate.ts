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

function isCommentLine(line: string): boolean {
  return /^(?:\/\/|\/\*|\*\/|\*|#)/.test(line);
}

function isImportOrDeclarationLine(line: string): boolean {
  return /^(?:import|export\s+import|use|namespace|require(?:_once)?|include(?:_once)?)\b/i.test(line)
    || /^(?:export\s+)?(?:abstract\s+|final\s+)?(?:class|interface|trait|enum|record|module)\b/i.test(line);
}

function isCallableDeclarationLine(line: string): boolean {
  if (/\bfunction\b/.test(line)) return true;
  if (/^(?:async\s+)?[A-Za-z_$][\w$]*\s*\([^;=]*\)\s*\{$/.test(line) && !/^(?:if|for|while|switch|catch|foreach)\b/.test(line)) {
    return true;
  }
  return /^(?:(?:public|protected|private|internal|static|final|abstract|async|override|virtual|sealed|readonly)\s+)+[A-Za-z_$][\w$<>\[\]?|:&\\]*\s+[A-Za-z_$][\w$]*\s*\([^;=]*\)\s*(?::\s*[A-Za-z_$][\w$<>\[\]?|:&\\]*)?\s*\{?$/.test(line);
}

function isBoundaryLine(line: string): boolean {
  return line === '' || isCommentLine(line) || isImportOrDeclarationLine(line) || isCallableDeclarationLine(line);
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
  return line !== ''
    && !isStructuralLine(line)
    && !isCommentLine(line)
    && !isImportOrDeclarationLine(line)
    && !isCallableDeclarationLine(line);
}

export function findDuplicateSlices(content: string, windowSize = DEFAULT_DUPLICATE_LINES): DupSlice[] {
  const normalizedWindowSize = Math.max(3, Math.floor(windowSize));
  const lines = content.split(/\r\n|\n|\r/).map(normalize);

  const segments: number[][] = [];
  let currentSegment: number[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (isBoundaryLine(line)) {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
        currentSegment = [];
      }
      continue;
    }

    if (isSubstantiveLine(line)) currentSegment.push(index);
  }

  if (currentSegment.length > 0) segments.push(currentSegment);

  const out: DupSlice[] = [];

  for (const segment of segments) {
    if (segment.length < normalizedWindowSize) continue;

    for (let i = 0; i + normalizedWindowSize <= segment.length; i++) {
      const windowIndexes = segment.slice(i, i + normalizedWindowSize);
      const startIndex = windowIndexes[0];
      const endIndex = windowIndexes[windowIndexes.length - 1];
      const substantiveSlice = windowIndexes.map(index => lines[index]);
      if (substantiveSlice.length < Math.max(MIN_SUBSTANTIVE_LINES, normalizedWindowSize)) continue;
      const h = createHash('sha1').update(substantiveSlice.join('\n')).digest('hex').slice(0, 16);
      out.push({ hash: h, startLine: startIndex + 1, endLine: endIndex + 1 });
    }
  }

  return out;
}
