interface RelationSourceFile {
  relPath: string;
  lang: string;
  total: number;
  code: number;
  content: string;
}

export interface FileRelationNode {
  id: string;
  relPath: string;
  lang: string;
  total: number;
  code: number;
  incoming: number;
  outgoing: number;
  group: string;
  isTest: boolean;
}

export interface FileRelationEdge {
  source: string;
  target: string;
  value: number;
}

export interface FileRelationGraph {
  nodes: FileRelationNode[];
  edges: FileRelationEdge[];
  scannedFiles: number;
  connectedFiles: number;
  unresolvedCount: number;
}

interface ComposerNamespaceMapping {
  prefix: string;
  dirPath: string;
}

const TEST_DIR_SEGMENTS = new Set(['__tests__', '__test__', 'tests', 'test', 'spec', 'specs', 'e2e', 'cypress']);
const TEST_FILE_PATTERNS = [
  /\.(?:test|spec)\.[^/.]+$/i,
  /[_-](?:test|spec)\.[^/.]+$/i,
  /[A-Z][A-Za-z0-9]*(?:Test|Tests|Spec|Specs)\.[^/.]+$/,
];
const IMPORT_PATTERNS = [
  /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
  /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  /\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  /\b(?:require|require_once|include|include_once)\s*\(?\s*["'`]([^"'`]+)["'`]\s*\)?/g,
  /@import\s+(?:url\()?\s*["'`]([^"'`]+)["'`]/g,
  /\bfrom\s+(\.+[A-Za-z0-9_./-]*)\s+import\b/g,
];
const EXTENSION_PRIORITY = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.css', '.scss', '.sass', '.less', '.py', '.php'];

function normalizeRelPath(relPath: string): string {
  const parts = relPath.replace(/\\/g, '/').split('/');
  const normalized: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }

  return normalized.join('/');
}

function dirname(relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? '' : normalized.slice(0, lastSlash);
}

function joinPath(basePath: string, specifier: string): string {
  return normalizeRelPath([basePath, specifier].filter(Boolean).join('/'));
}

function stripExtension(relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  const fileName = normalized.slice(normalized.lastIndexOf('/') + 1);
  const extensionIndex = fileName.lastIndexOf('.');
  if (extensionIndex <= 0) return normalized;
  return normalized.slice(0, normalized.length - (fileName.length - extensionIndex));
}

function extensionPriority(relPath: string): number {
  const lowerPath = relPath.toLowerCase();
  const index = EXTENSION_PRIORITY.findIndex(extension => lowerPath.endsWith(extension));
  return index === -1 ? EXTENSION_PRIORITY.length : index;
}

function pickPreferredPath(current: string | undefined, next: string): string {
  if (!current) return next;
  const currentPriority = extensionPriority(current);
  const nextPriority = extensionPriority(next);
  if (nextPriority !== currentPriority) return nextPriority < currentPriority ? next : current;
  return next.length < current.length ? next : current;
}

function addLookupEntry(lookup: Map<string, string>, key: string, relPath: string): void {
  if (!key) return;
  lookup.set(key, pickPreferredPath(lookup.get(key), relPath));

  const lowerKey = key.toLowerCase();
  if (lowerKey !== key) lookup.set(lowerKey, pickPreferredPath(lookup.get(lowerKey), relPath));
}

function buildLookup(files: RelationSourceFile[]): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const file of files) {
    const normalizedPath = normalizeRelPath(file.relPath);
    const withoutExtension = stripExtension(normalizedPath);
    addLookupEntry(lookup, normalizedPath, normalizedPath);
    addLookupEntry(lookup, withoutExtension, normalizedPath);

    const fileName = normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1);
    if (!/^index\.[^/.]+$/i.test(fileName)) continue;

    const dirPath = dirname(normalizedPath);
    addLookupEntry(lookup, dirPath, normalizedPath);
  }

  return lookup;
}

function collectSpecifiers(content: string): string[] {
  const specifiers = new Set<string>();

  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(content);
    while (match) {
      const specifier = match[1]?.trim();
      if (specifier) specifiers.add(specifier);
      match = pattern.exec(content);
    }
  }

  return Array.from(specifiers);
}

function normalizePhpNamespace(specifier: string): string {
  return normalizeRelPath(specifier.trim().replace(/^\\+/, '').replace(/\\/g, '/'));
}

function stripPhpUseAlias(specifier: string): string {
  return specifier.replace(/\s+as\s+[A-Za-z_][A-Za-z0-9_]*$/i, '').trim();
}

function stripPhpUseQualifier(specifier: string): string {
  return specifier.replace(/^(?:function|const)\s+/i, '').trim();
}

function splitPhpUseItems(value: string): string[] {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function expandPhpUseStatement(statement: string): string[] {
  const normalizedStatement = statement.replace(/\s+/g, ' ').trim();
  if (!normalizedStatement || normalizedStatement.startsWith('(') || normalizedStatement.includes('$')) return [];

  const groupStart = normalizedStatement.indexOf('{');
  const groupEnd = normalizedStatement.lastIndexOf('}');

  if (groupStart !== -1 && groupEnd > groupStart && normalizedStatement[groupStart - 1] === '\\') {
    const prefix = normalizePhpNamespace(stripPhpUseQualifier(normalizedStatement.slice(0, groupStart - 1)));
    const members = splitPhpUseItems(normalizedStatement.slice(groupStart + 1, groupEnd));
    return members
      .map(member => normalizePhpNamespace(`${prefix}/${stripPhpUseAlias(stripPhpUseQualifier(member))}`))
      .filter(Boolean);
  }

  return splitPhpUseItems(normalizedStatement)
    .map(member => normalizePhpNamespace(stripPhpUseAlias(stripPhpUseQualifier(member))))
    .filter(Boolean);
}

function collectPhpUseSpecifiers(content: string): string[] {
  const specifiers = new Set<string>();
  const usePattern = /^\s*use\s+([\s\S]*?);/gm;

  let match = usePattern.exec(content);
  while (match) {
    for (const specifier of expandPhpUseStatement(match[1] ?? '')) {
      specifiers.add(specifier);
    }
    match = usePattern.exec(content);
  }

  return Array.from(specifiers);
}

function collectSpecifiersForFile(file: RelationSourceFile): string[] {
  const specifiers = new Set(collectSpecifiers(file.content));

  if (file.lang.toLowerCase() === 'php') {
    for (const specifier of collectPhpUseSpecifiers(file.content)) {
      specifiers.add(specifier);
    }
  }

  return Array.from(specifiers);
}

function parseComposerNamespaceMappings(files: RelationSourceFile[]): ComposerNamespaceMapping[] {
  const mappings: ComposerNamespaceMapping[] = [];

  for (const file of files) {
    const normalizedPath = normalizeRelPath(file.relPath);
    if (!(normalizedPath === 'composer.json' || normalizedPath.endsWith('/composer.json'))) continue;

    try {
      const parsed = JSON.parse(file.content) as Record<string, unknown>;
      const composerDir = dirname(normalizedPath);

      for (const sectionName of ['autoload', 'autoload-dev'] as const) {
        const section = parsed[sectionName];
        if (!section || typeof section !== 'object' || Array.isArray(section)) continue;

        for (const key of ['psr-4', 'psr-0'] as const) {
          const record = (section as Record<string, unknown>)[key];
          if (!record || typeof record !== 'object' || Array.isArray(record)) continue;

          for (const [prefix, rawDirs] of Object.entries(record as Record<string, unknown>)) {
            const normalizedPrefix = normalizePhpNamespace(prefix).replace(/\/+$/, '');
            const dirs = Array.isArray(rawDirs) ? rawDirs : [rawDirs];

            for (const rawDir of dirs) {
              if (typeof rawDir !== 'string' || rawDir.trim() === '') continue;
              mappings.push({
                prefix: normalizedPrefix,
                dirPath: joinPath(composerDir, rawDir),
              });
            }
          }
        }
      }
    } catch {
      // Ignore malformed composer.json files and fall back to path heuristics.
    }
  }

  return mappings.sort((left, right) => right.prefix.length - left.prefix.length || left.dirPath.localeCompare(right.dirPath));
}

function resolveLookupCandidate(candidate: string, lookup: Map<string, string>): string | null {
  const normalizedCandidate = normalizeRelPath(candidate);
  const candidateKeys = [normalizedCandidate];
  const withoutExtension = stripExtension(normalizedCandidate);
  if (withoutExtension !== normalizedCandidate) candidateKeys.push(withoutExtension);

  for (const candidateKey of candidateKeys) {
    const resolved = lookup.get(candidateKey) ?? lookup.get(candidateKey.toLowerCase());
    if (resolved) return resolved;
  }

  return null;
}

function resolvePhpSpecifier(specifier: string, lookup: Map<string, string>, composerMappings: ComposerNamespaceMapping[]): string | null {
  const normalizedSpecifier = normalizePhpNamespace(specifier);
  if (!normalizedSpecifier) return null;

  for (const mapping of composerMappings) {
    if (mapping.prefix && normalizedSpecifier !== mapping.prefix && !normalizedSpecifier.startsWith(`${mapping.prefix}/`)) continue;

    const suffix = mapping.prefix
      ? normalizedSpecifier.slice(mapping.prefix.length).replace(/^\/+/, '')
      : normalizedSpecifier;
    if (!suffix) continue;

    const resolved = resolveLookupCandidate(joinPath(mapping.dirPath, suffix), lookup);
    if (resolved) return resolved;
  }

  return resolveLookupCandidate(normalizedSpecifier, lookup);
}

function resolveLocalSpecifier(file: RelationSourceFile, specifier: string, lookup: Map<string, string>, composerMappings: ComposerNamespaceMapping[]): string | null {
  if (!specifier.startsWith('.')) {
    if (file.lang.toLowerCase() === 'php') return resolvePhpSpecifier(specifier, lookup, composerMappings);
    return null;
  }

  const resolvedBase = joinPath(dirname(file.relPath), specifier);
  return resolveLookupCandidate(resolvedBase, lookup);
}

function isTestFilePath(relPath: string): boolean {
  const normalized = normalizeRelPath(relPath);
  const segments = normalized.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] ?? normalized;
  if (segments.slice(0, -1).some(segment => TEST_DIR_SEGMENTS.has(segment.toLowerCase()))) return true;
  return TEST_FILE_PATTERNS.some(pattern => pattern.test(fileName));
}

function topLevelGroup(relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  const [firstSegment] = normalized.split('/').filter(Boolean);
  return firstSegment || '(root)';
}

export function buildFileRelationGraph(files: RelationSourceFile[]): FileRelationGraph {
  const normalizedFiles = files.map(file => ({
    ...file,
    relPath: normalizeRelPath(file.relPath),
  }));
  const lookup = buildLookup(normalizedFiles);
  const composerMappings = parseComposerNamespaceMappings(normalizedFiles);
  const edgesMap = new Map<string, FileRelationEdge>();
  const incomingCounts = new Map<string, number>();
  const outgoingCounts = new Map<string, number>();
  let unresolvedCount = 0;

  for (const file of normalizedFiles) {
    const targets = new Set<string>();
    for (const specifier of collectSpecifiersForFile(file)) {
      const target = resolveLocalSpecifier(file, specifier, lookup, composerMappings);
      if (!target) {
        if (specifier.startsWith('.') || file.lang.toLowerCase() === 'php') unresolvedCount += 1;
        continue;
      }
      if (target === file.relPath) continue;
      targets.add(target);
    }

    if (targets.size === 0) continue;
    outgoingCounts.set(file.relPath, targets.size);

    for (const target of targets) {
      incomingCounts.set(target, (incomingCounts.get(target) ?? 0) + 1);
      const edgeKey = `${file.relPath}=>${target}`;
      edgesMap.set(edgeKey, {
        source: file.relPath,
        target,
        value: (edgesMap.get(edgeKey)?.value ?? 0) + 1,
      });
    }
  }

  const nodes = normalizedFiles
    .filter(file => (incomingCounts.get(file.relPath) ?? 0) > 0 || (outgoingCounts.get(file.relPath) ?? 0) > 0)
    .map<FileRelationNode>(file => ({
      id: file.relPath,
      relPath: file.relPath,
      lang: file.lang,
      total: file.total,
      code: file.code,
      incoming: incomingCounts.get(file.relPath) ?? 0,
      outgoing: outgoingCounts.get(file.relPath) ?? 0,
      group: topLevelGroup(file.relPath),
      isTest: isTestFilePath(file.relPath),
    }))
    .sort((left, right) => (right.incoming + right.outgoing) - (left.incoming + left.outgoing) || right.code - left.code || left.relPath.localeCompare(right.relPath));

  const edges = Array.from(edgesMap.values())
    .sort((left, right) => right.value - left.value || left.source.localeCompare(right.source) || left.target.localeCompare(right.target));

  return {
    nodes,
    edges,
    scannedFiles: normalizedFiles.length,
    connectedFiles: nodes.length,
    unresolvedCount,
  };
}