import ignore from 'ignore';
import type {
  DirNode,
  DuplicateCluster,
  FileMeta,
  FolderRules,
  FolderStats,
  HeatmapBucket,
  ScanProgress,
  TagRow,
  TopFile,
  TopFunction,
} from '../../shared/api';
import { DEFAULT_DUPLICATE_LINES } from '../../shared/api';
import { detectLang } from '../../main/parsers/languages';
import { countLines } from '../../main/parsers/lineParser';
import { scanTags } from '../../main/parsers/tagScanner';
import { findFunctions } from '../../main/parsers/funcDetect';
import { isExcludedAssetPath } from '../../main/scanner/fileFilters';

const TEST_DIR_SEGMENTS = new Set(['__tests__', '__test__', 'tests', 'test', 'spec', 'specs', 'e2e', 'cypress']);
const TEST_FILE_PATTERNS = [
  /\.(?:test|spec)\.[^/.]+$/i,
  /[_-](?:test|spec)\.[^/.]+$/i,
  /[A-Z][A-Za-z0-9]*(?:Test|Tests|Spec|Specs)\.[^/.]+$/,
];

export interface BrowserSourceFile {
  relPath: string;
  size: number;
  mtime: number;
  readText: () => Promise<string>;
}

export interface BrowserAnalyzedFile {
  relPath: string;
  content: string;
  meta: FileMeta;
  tags: TagRow[];
  functions: TopFunction[];
  duplicateSlices: Array<{ hash: string; startLine: number; endLine: number }>;
}

export interface BrowserFolderAnalysis {
  files: BrowserAnalyzedFile[];
  summary: FolderStats;
  tree: DirNode;
  topFiles: TopFile[];
  topFunctions: TopFunction[];
  tags: Array<TagRow & { relPath: string }>;
  heatmap: HeatmapBucket[];
  duplicates: DuplicateCluster[];
}

interface AnalyzeOptions {
  folderId: number;
  sourceFiles: BrowserSourceFile[];
  rules: FolderRules;
  duplicateRules?: FolderRules;
  duplicateMinLines?: number;
  detectDuplicates?: boolean;
  onProgress?: (progress: ScanProgress) => void;
  shouldCancel?: () => boolean;
}

const textEncoder = new TextEncoder();

function normalizeRelPath(relPath: string): string {
  return relPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegExp(pattern: string): RegExp {
  let out = '^';

  for (let index = 0; index < pattern.length; index += 1) {
    const current = pattern[index];
    const next = pattern[index + 1];
    const afterNext = pattern[index + 2];

    if (current === '*' && next === '*') {
      if (afterNext === '/') {
        out += '(?:[^/]+/)*';
        index += 2;
        continue;
      }

      out += '.*';
      index += 1;
      continue;
    }

    if (current === '*') {
      out += '[^/]*';
      continue;
    }

    if (current === '?') {
      out += '[^/]';
      continue;
    }

    out += escapeRegex(current);
  }

  out += '$';
  return new RegExp(out);
}

function expandLoosePattern(pattern: string): string[] {
  const normalized = normalizeRelPath(pattern.trim());
  if (!normalized) return [];
  if (normalized.includes('/')) return [normalized];
  return [normalized, `**/${normalized}`, `**/${normalized}/**`];
}

function createMatchers(patterns: string[], loose = false): RegExp[] {
  return patterns
    .flatMap(pattern => (loose ? expandLoosePattern(pattern) : [normalizeRelPath(pattern.trim())]))
    .filter(Boolean)
    .map(globToRegExp);
}

function matchesAny(relPath: string, matchers: RegExp[]): boolean {
  return matchers.some(matcher => matcher.test(relPath));
}

async function loadGitignore(sourceFiles: BrowserSourceFile[]): Promise<ignore.Ignore> {
  const matcher = ignore();
  const gitignoreSource = sourceFiles.find(file => normalizeRelPath(file.relPath) === '.gitignore');
  if (!gitignoreSource) return matcher;

  try {
    matcher.add(await gitignoreSource.readText());
  } catch {
    // Ignore malformed or unreadable .gitignore files in browser mode.
  }

  return matcher;
}

function simpleHashHex(input: string): string {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b1;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hashA ^= code;
    hashA = Math.imul(hashA, 0x01000193);
    hashB ^= code;
    hashB = Math.imul(hashB, 0x85ebca6b);
  }

  return `${(hashA >>> 0).toString(16).padStart(8, '0')}${(hashB >>> 0).toString(16).padStart(8, '0')}`;
}

async function sha1Hex(input: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-1', textEncoder.encode(input));
    return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
  }

  return simpleHashHex(input);
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

function stripJsxTags(line: string): string {
  return line
    .replace(/<>|<\/>/g, '')
    .replace(/<\/?[A-Za-z][\w.:\-]*(?:\s+[^<>]*)?\/?\s*>/g, '');
}

function isBoundaryLine(line: string): boolean {
  return line === '' || isCommentLine(line) || isImportOrDeclarationLine(line) || isCallableDeclarationLine(line);
}

function isStructuralLine(line: string): boolean {
  if (line === '') return true;
  if (/^[{}()[\];,]+$/.test(line)) return true;
  if (/^return\s*[({[]$/.test(line)) return true;
  const withoutJsx = stripJsxTags(line).replace(/[{}()[\];,]/g, '').trim();
  return withoutJsx === '';
}

function isSubstantiveLine(line: string): boolean {
  return line !== ''
    && !isStructuralLine(line)
    && !isCommentLine(line)
    && !isImportOrDeclarationLine(line)
    && !isCallableDeclarationLine(line);
}

function normalizeDuplicateLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function findDuplicateSlicesWeb(content: string, windowSize = DEFAULT_DUPLICATE_LINES): Array<{ hash: string; startLine: number; endLine: number }> {
  const normalizedWindowSize = Math.max(3, Math.floor(windowSize));
  const lines = content.split(/\r\n|\n|\r/).map(normalizeDuplicateLine);
  const segments: number[][] = [];
  let currentSegment: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
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

  const out: Array<{ hash: string; startLine: number; endLine: number }> = [];

  for (const segment of segments) {
    if (segment.length < normalizedWindowSize) continue;

    for (let index = 0; index + normalizedWindowSize <= segment.length; index += 1) {
      const windowIndexes = segment.slice(index, index + normalizedWindowSize);
      const startIndex = windowIndexes[0];
      const endIndex = windowIndexes[windowIndexes.length - 1];
      const linesInWindow = windowIndexes.map(lineIndex => lines[lineIndex]);
      out.push({
        hash: simpleHashHex(linesInWindow.join('\n')).slice(0, 16),
        startLine: startIndex + 1,
        endLine: endIndex + 1,
      });
    }
  }

  return out;
}

function isTestFilePath(relPath: string): boolean {
  const normalized = normalizeRelPath(relPath);
  const segments = normalized.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] ?? normalized;

  if (segments.slice(0, -1).some(segment => TEST_DIR_SEGMENTS.has(segment.toLowerCase()))) return true;
  return TEST_FILE_PATTERNS.some(pattern => pattern.test(fileName));
}

function buildSummary(files: BrowserAnalyzedFile[]): FolderStats {
  const tagCounts: Record<string, number> = {};
  const byLangMap = new Map<string, { lang: string; files: number; total: number; code: number; comment: number; blank: number }>();

  let totalFiles = 0;
  let totalLines = 0;
  let totalCode = 0;
  let totalComment = 0;
  let totalBlank = 0;
  let totalBlockComment = 0;
  let testCode = 0;

  for (const file of files) {
    totalFiles += 1;
    totalLines += file.meta.total;
    totalCode += file.meta.code;
    totalComment += file.meta.comment;
    totalBlank += file.meta.blank;
    totalBlockComment += file.meta.blockComment;
    if (isTestFilePath(file.relPath)) testCode += file.meta.code;

    const byLang = byLangMap.get(file.meta.lang) ?? {
      lang: file.meta.lang,
      files: 0,
      total: 0,
      code: 0,
      comment: 0,
      blank: 0,
    };
    byLang.files += 1;
    byLang.total += file.meta.total;
    byLang.code += file.meta.code;
    byLang.comment += file.meta.comment;
    byLang.blank += file.meta.blank;
    byLangMap.set(file.meta.lang, byLang);

    for (const tag of file.tags) {
      tagCounts[tag.kind] = (tagCounts[tag.kind] ?? 0) + 1;
    }
  }

  const byLang = Array.from(byLangMap.values()).sort((left, right) => right.total - left.total);
  return {
    totalFiles,
    totalLines,
    totalCode,
    runtimeCode: Math.max(0, totalCode - testCode),
    testCode,
    totalComment,
    totalBlank,
    totalBlockComment,
    byLang,
    tagCounts,
  };
}

function buildTree(files: BrowserAnalyzedFile[]): DirNode {
  const root: DirNode = {
    name: '/',
    path: '',
    isDir: true,
    total: 0,
    code: 0,
    comment: 0,
    blank: 0,
    files: 0,
    children: [],
  };
  const directories = new Map<string, DirNode>();
  directories.set('', root);

  function getDirectory(path: string): DirNode {
    const existing = directories.get(path);
    if (existing) return existing;

    const segments = path.split('/');
    const parentPath = segments.slice(0, -1).join('/');
    const parent = getDirectory(parentPath);
    const next: DirNode = {
      name: segments[segments.length - 1],
      path,
      isDir: true,
      total: 0,
      code: 0,
      comment: 0,
      blank: 0,
      files: 0,
      children: [],
    };
    parent.children!.push(next);
    directories.set(path, next);
    return next;
  }

  for (const file of files) {
    const segments = file.relPath.split('/');
    const fileName = segments.pop() ?? file.relPath;
    const directoryPath = segments.join('/');
    getDirectory(directoryPath).children!.push({
      name: fileName,
      path: file.relPath,
      isDir: false,
      total: file.meta.total,
      code: file.meta.code,
      comment: file.meta.comment,
      blank: file.meta.blank,
      files: 1,
    });
  }

  function aggregate(node: DirNode): void {
    if (!node.isDir) return;

    let total = 0;
    let code = 0;
    let comment = 0;
    let blank = 0;
    let filesCount = 0;

    for (const child of node.children ?? []) {
      aggregate(child);
      total += child.total;
      code += child.code;
      comment += child.comment;
      blank += child.blank;
      filesCount += child.isDir ? child.files : 1;
    }

    node.total = total;
    node.code = code;
    node.comment = comment;
    node.blank = blank;
    node.files = filesCount;
    node.children?.sort((left, right) => (right.isDir ? 1 : 0) - (left.isDir ? 1 : 0) || right.total - left.total);
  }

  aggregate(root);
  return root;
}

function buildHeatmap(files: BrowserAnalyzedFile[], days = 365): HeatmapBucket[] {
  const since = Date.now() - days * 86400_000;
  const buckets = new Map<string, { files: number; lines: number }>();

  for (const file of files) {
    if (file.meta.mtime < since) continue;
    const date = new Date(file.meta.mtime);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const bucket = buckets.get(key) ?? { files: 0, lines: 0 };
    bucket.files += 1;
    bucket.lines += file.meta.total;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.entries())
    .map(([date, value]) => ({ date, ...value }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function duplicateSignature(occurrences: DuplicateCluster['occurrences']): string {
  return occurrences.map(occurrence => occurrence.relPath).join('|');
}

function clusterOrderValue(cluster: DuplicateCluster): string {
  return cluster.occurrences
    .map(occurrence => `${occurrence.relPath}:${String(occurrence.startLine).padStart(8, '0')}:${String(occurrence.endLine).padStart(8, '0')}`)
    .join('|');
}

function hasStableDuplicateAlignment(current: DuplicateCluster, next: DuplicateCluster): boolean {
  if (current.occurrences.length !== next.occurrences.length) return false;

  const currentBase = current.occurrences[0];
  const nextBase = next.occurrences[0];

  for (let index = 0; index < current.occurrences.length; index += 1) {
    const currentOccurrence = current.occurrences[index];
    const nextOccurrence = next.occurrences[index];
    if (currentOccurrence.relPath !== nextOccurrence.relPath) return false;

    const currentStartOffset = currentOccurrence.startLine - currentBase.startLine;
    const nextStartOffset = nextOccurrence.startLine - nextBase.startLine;
    const currentEndOffset = currentOccurrence.endLine - currentBase.endLine;
    const nextEndOffset = nextOccurrence.endLine - nextBase.endLine;

    if (currentStartOffset !== nextStartOffset || currentEndOffset !== nextEndOffset) return false;

    const overlaps = nextOccurrence.startLine <= currentOccurrence.endLine + 1
      && nextOccurrence.endLine >= currentOccurrence.startLine - 1;
    if (!overlaps) return false;
  }

  return true;
}

function mergeDuplicateClusters(current: DuplicateCluster, next: DuplicateCluster): DuplicateCluster {
  const occurrences = current.occurrences.map((occurrence, index) => ({
    relPath: occurrence.relPath,
    startLine: Math.min(occurrence.startLine, next.occurrences[index].startLine),
    endLine: Math.max(occurrence.endLine, next.occurrences[index].endLine),
  }));

  return {
    hash: current.hash,
    occurrences,
    lines: Math.max(...occurrences.map(occurrence => occurrence.endLine - occurrence.startLine + 1)),
  };
}

function compactDuplicateClusters(clusters: DuplicateCluster[]): DuplicateCluster[] {
  const grouped = new Map<string, DuplicateCluster[]>();

  for (const cluster of clusters) {
    const signature = duplicateSignature(cluster.occurrences);
    const items = grouped.get(signature) ?? [];
    items.push(cluster);
    grouped.set(signature, items);
  }

  const merged: DuplicateCluster[] = [];

  for (const items of grouped.values()) {
    items.sort((left, right) => clusterOrderValue(left).localeCompare(clusterOrderValue(right)));
    let current = items[0];

    for (let index = 1; index < items.length; index += 1) {
      const next = items[index];
      if (hasStableDuplicateAlignment(current, next)) {
        current = mergeDuplicateClusters(current, next);
        continue;
      }

      merged.push(current);
      current = next;
    }

    merged.push(current);
  }

  return merged;
}

function buildDuplicates(files: BrowserAnalyzedFile[], duplicateMinLines: number): DuplicateCluster[] {
  const groups = new Map<string, DuplicateCluster['occurrences']>();

  for (const file of files) {
    for (const slice of file.duplicateSlices) {
      const items = groups.get(slice.hash) ?? [];
      items.push({ relPath: file.relPath, startLine: slice.startLine, endLine: slice.endLine });
      groups.set(slice.hash, items);
    }
  }

  const clusters: DuplicateCluster[] = [];
  for (const [hash, occurrences] of groups) {
    if (occurrences.length < 2) continue;
    clusters.push({
      hash,
      occurrences: [...occurrences].sort((left, right) => {
        if (left.relPath !== right.relPath) return left.relPath.localeCompare(right.relPath);
        if (left.startLine !== right.startLine) return left.startLine - right.startLine;
        return left.endLine - right.endLine;
      }),
      lines: duplicateMinLines,
    });
  }

  const compacted = compactDuplicateClusters(clusters);
  compacted.sort((left, right) => {
    const scoreDiff = right.occurrences.length * right.lines - left.occurrences.length * left.lines;
    if (scoreDiff !== 0) return scoreDiff;
    return right.lines - left.lines;
  });
  return compacted.slice(0, 200);
}

function filterSourceFiles(sourceFiles: BrowserSourceFile[], rules: FolderRules, gitignoreMatcher: ignore.Ignore): BrowserSourceFile[] {
  const whitelistMatchers = createMatchers(rules.whitelist);
  const blacklistMatchers = createMatchers(rules.blacklist, true);

  return sourceFiles.filter(sourceFile => {
    const relPath = normalizeRelPath(sourceFile.relPath);
    if (!relPath || isExcludedAssetPath(relPath)) return false;
    if (gitignoreMatcher.ignores(relPath)) return false;
    if (whitelistMatchers.length > 0 && !matchesAny(relPath, whitelistMatchers)) return false;
    if (blacklistMatchers.length > 0 && matchesAny(relPath, blacklistMatchers)) return false;
    return true;
  });
}

function resolveDuplicateEligiblePaths(relPaths: string[], rules: FolderRules | undefined): Set<string> | null {
  if (!rules || (rules.whitelist.length === 0 && rules.blacklist.length === 0)) return null;

  const whitelistMatchers = createMatchers(rules.whitelist);
  const blacklistMatchers = createMatchers(rules.blacklist, true);
  const allowed = relPaths.filter(relPath => {
    if (whitelistMatchers.length > 0 && !matchesAny(relPath, whitelistMatchers)) return false;
    if (blacklistMatchers.length > 0 && matchesAny(relPath, blacklistMatchers)) return false;
    return true;
  });

  return new Set(allowed);
}

export async function analyzeBrowserFolder(options: AnalyzeOptions): Promise<BrowserFolderAnalysis> {
  const {
    folderId,
    sourceFiles,
    rules,
    duplicateRules,
    duplicateMinLines = DEFAULT_DUPLICATE_LINES,
    detectDuplicates = false,
    onProgress,
    shouldCancel,
  } = options;

  onProgress?.({ folderId, phase: 'walking', total: 0, done: 0 });

  const gitignoreMatcher = await loadGitignore(sourceFiles);
  const filteredSources = filterSourceFiles(sourceFiles, rules, gitignoreMatcher);
  const relPaths = filteredSources.map(sourceFile => normalizeRelPath(sourceFile.relPath));
  const duplicateEligiblePaths = detectDuplicates
    ? resolveDuplicateEligiblePaths(relPaths, duplicateRules)
    : null;

  onProgress?.({ folderId, phase: 'parsing', total: filteredSources.length, done: 0 });

  const files: BrowserAnalyzedFile[] = [];
  for (let index = 0; index < filteredSources.length; index += 1) {
    if (shouldCancel?.()) break;

    const sourceFile = filteredSources[index];
    const relPath = normalizeRelPath(sourceFile.relPath);
    const content = await sourceFile.readText();
    const { ext, lang, langId } = detectLang(relPath);
    const counts = countLines(content, lang);
    const tags = scanTags(content, lang).map(tag => ({ ...tag, fileId: 0 }));
    const functions = findFunctions(content, ext).map(fn => ({ ...fn, relPath }));
    const duplicateSlices = detectDuplicates && (duplicateEligiblePaths == null || duplicateEligiblePaths.has(relPath))
      ? findDuplicateSlicesWeb(content, duplicateMinLines)
      : [];
    const hash = await sha1Hex(content);

    files.push({
      relPath,
      content,
      meta: {
        relPath,
        size: sourceFile.size,
        mtime: sourceFile.mtime,
        lang: langId,
        total: counts.total,
        code: counts.code,
        comment: counts.comment,
        blank: counts.blank,
        blockComment: counts.blockComment,
        hash,
      },
      tags,
      functions,
      duplicateSlices,
    });

    onProgress?.({
      folderId,
      phase: 'parsing',
      total: filteredSources.length,
      done: index + 1,
      current: relPath,
    });

    if ((index + 1) % 20 === 0) {
      await Promise.resolve();
    }
  }

  onProgress?.({ folderId, phase: 'persisting', total: files.length, done: files.length });

  const summary = buildSummary(files);
  const tree = buildTree(files);
  const topFiles = [...files]
    .map(file => ({
      relPath: file.relPath,
      total: file.meta.total,
      code: file.meta.code,
      size: file.meta.size,
      lang: file.meta.lang,
      lastCommitDate: null as number | null,
    }))
    .sort((left, right) => right.total - left.total);
  const topFunctions = files
    .flatMap(file => file.functions)
    .sort((left, right) => right.length - left.length)
    .slice(0, 200);
  const tags = files
    .flatMap(file => file.tags.map(tag => ({ ...tag, relPath: file.relPath })))
    .sort((left, right) => left.relPath.localeCompare(right.relPath) || left.lineNo - right.lineNo);
  const heatmap = buildHeatmap(files);
  const duplicates = detectDuplicates ? buildDuplicates(files, duplicateMinLines) : [];

  onProgress?.({ folderId, phase: 'done', total: files.length, done: files.length });
  return { files, summary, tree, topFiles, topFunctions, tags, heatmap, duplicates };
}