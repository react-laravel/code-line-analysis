interface ApiSourceFile {
  relPath: string;
  lang: string;
  total: number;
  code: number;
  content: string;
}

export interface ApiRouteEntry {
  framework: 'laravel' | 'next-pages' | 'next-app';
  methods: string[];
  path: string;
  handler: string;
  sourceFile: string;
  routeName: string | null;
}

export interface ApiRouteOverview {
  frameworks: Array<ApiRouteEntry['framework']>;
  routes: ApiRouteEntry[];
  laravelRouteFiles: number;
  nextRouteFiles: number;
  warnings: string[];
}

const HTTP_METHOD_ORDER = ['PAGE', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'ANY'];
const NEXT_ROUTE_EXTENSIONS = /\.(?:ts|tsx|js|jsx)$/i;

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function basename(relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

function normalizeRoutePath(routePath: string): string {
  const normalized = routePath.trim().replace(/^\/+/, '');
  if (!normalized) return '/';
  return `/${normalized}`.replace(/\/+/g, '/');
}

function sortMethods(methods: string[]): string[] {
  return [...new Set(methods.map(method => method.toUpperCase()))]
    .sort((left, right) => {
      const leftIndex = HTTP_METHOD_ORDER.indexOf(left);
      const rightIndex = HTTP_METHOD_ORDER.indexOf(right);
      return (leftIndex === -1 ? HTTP_METHOD_ORDER.length : leftIndex) - (rightIndex === -1 ? HTTP_METHOD_ORDER.length : rightIndex) || left.localeCompare(right);
    });
}

function splitArgs(args: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;
  let depth = 0;

  for (let index = 0; index < args.length; index += 1) {
    const char = args[index];
    const previous = args[index - 1];

    if (quote) {
      current += char;
      if (char === quote && previous !== '\\') quote = null;
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);

    if (char === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) out.push(current.trim());
  return out;
}

function readStringLiteral(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^['"`]([^'"`]+)['"`]$/);
  return match?.[1] ?? null;
}

function readFirstString(value: string | undefined): string | null {
  if (!value) return null;
  return value.match(/['"`]([^'"`]+)['"`]/)?.[1] ?? null;
}

function findMatchingParen(value: string, openIndex: number): number {
  let quote: string | null = null;
  let depth = 0;

  for (let index = openIndex; index < value.length; index += 1) {
    const char = value[index];
    const previous = value[index - 1];

    if (quote) {
      if (char === quote && previous !== '\\') quote = null;
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function collectLaravelRouteStatements(content: string): string[] {
  const statements: string[] = [];
  let index = 0;

  while (index < content.length) {
    const routeIndex = content.indexOf('Route::', index);
    if (routeIndex === -1) break;

    let quote: string | null = null;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let endIndex = -1;

    for (let cursor = routeIndex; cursor < content.length; cursor += 1) {
      const char = content[cursor];
      const previous = content[cursor - 1];

      if (quote) {
        if (char === quote && previous !== '\\') quote = null;
        continue;
      }

      if (char === '\'' || char === '"' || char === '`') {
        quote = char;
        continue;
      }

      if (char === '(') parenDepth += 1;
      if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
      if (char === '[') bracketDepth += 1;
      if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
      if (char === '{') braceDepth += 1;
      if (char === '}') braceDepth = Math.max(0, braceDepth - 1);

      if (char === ';' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        endIndex = cursor;
        break;
      }
    }

    if (endIndex === -1) break;
    statements.push(content.slice(routeIndex, endIndex + 1).trim());
    index = endIndex + 1;
  }

  return statements;
}

function extractLaravelCall(statement: string): { callName: string; args: string; chain: string } | null {
  const header = statement.match(/^Route::([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  if (!header?.[1]) return null;
  const openIndex = statement.indexOf('(', header[0].length - 1);
  if (openIndex === -1) return null;
  const closeIndex = findMatchingParen(statement, openIndex);
  if (closeIndex === -1) return null;
  return {
    callName: header[1],
    args: statement.slice(openIndex + 1, closeIndex),
    chain: statement.slice(closeIndex + 1),
  };
}

function parseLaravelHandler(value: string | undefined): string {
  if (!value) return 'Closure';
  if (/\b(?:function|fn)\b/.test(value)) return 'Closure';

  const arrayHandler = value.match(/\[\s*([A-Za-z0-9_\\]+)::class\s*,\s*['"`]([^'"`]+)['"`]\s*\]/);
  if (arrayHandler?.[1] && arrayHandler[2]) return `${arrayHandler[1]}@${arrayHandler[2]}`;

  const classHandler = value.match(/([A-Za-z0-9_\\]+)::class/);
  if (classHandler?.[1]) return classHandler[1];

  const stringHandler = readStringLiteral(value);
  if (stringHandler) return stringHandler;
  return 'Closure';
}

function parseLaravelRouteName(chain: string): string | null {
  return chain.match(/->name\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/)?.[1] ?? null;
}

function normalizeLaravelPath(routePath: string, sourceFile: string): string {
  const normalized = normalizeRoutePath(routePath);
  const isApiFile = sourceFile === 'routes/api.php' || sourceFile.startsWith('routes/api/');
  if (!isApiFile) return normalized;
  if (normalized === '/' || normalized === '/api') return '/api';
  if (normalized.startsWith('/api/')) return normalized;
  return normalizeRoutePath(`api${normalized}`);
}

function parseMatchMethods(value: string): string[] {
  const methods = Array.from(value.matchAll(/['"`]([A-Za-z]+)['"`]/g)).map(match => match[1].toUpperCase());
  return methods.length > 0 ? sortMethods(methods) : ['ANY'];
}

function laravelResourceRoutes(resource: string, controller: string, sourceFile: string, routeName: string | null): ApiRouteEntry[] {
  const basePath = normalizeLaravelPath(resource, sourceFile);
  const itemPath = basePath === '/' ? '/{id}' : `${basePath}/{id}`;
  return [
    { framework: 'laravel', methods: ['GET'], path: basePath, handler: `${controller}@index`, sourceFile, routeName: routeName ? `${routeName}.index` : null },
    { framework: 'laravel', methods: ['POST'], path: basePath, handler: `${controller}@store`, sourceFile, routeName: routeName ? `${routeName}.store` : null },
    { framework: 'laravel', methods: ['GET'], path: itemPath, handler: `${controller}@show`, sourceFile, routeName: routeName ? `${routeName}.show` : null },
    { framework: 'laravel', methods: ['PUT', 'PATCH'], path: itemPath, handler: `${controller}@update`, sourceFile, routeName: routeName ? `${routeName}.update` : null },
    { framework: 'laravel', methods: ['DELETE'], path: itemPath, handler: `${controller}@destroy`, sourceFile, routeName: routeName ? `${routeName}.destroy` : null },
  ];
}

function parseLaravelRoutes(files: ApiSourceFile[]): { routes: ApiRouteEntry[]; routeFileCount: number; warnings: string[] } {
  const routeFiles = files.filter(file => {
    const relPath = normalizeRelPath(file.relPath);
    return relPath === 'routes/api.php' || relPath.startsWith('routes/api/') && relPath.endsWith('.php');
  });
  const routes: ApiRouteEntry[] = [];
  const warnings: string[] = [];

  for (const file of routeFiles) {
    const relPath = normalizeRelPath(file.relPath);
    if (/Route::(?:prefix|controller|middleware|name)\s*\(/.test(file.content) || /->group\s*\(/.test(file.content)) {
      warnings.push('Laravel grouped route prefixes/controllers are only partially expanded; literal route declarations are shown directly.');
    }

    for (const statement of collectLaravelRouteStatements(file.content)) {
      const call = extractLaravelCall(statement);
      if (!call) continue;
      const args = splitArgs(call.args);
      const routeName = parseLaravelRouteName(call.chain);
      const callName = call.callName;

      if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'any'].includes(callName)) {
        const uri = readStringLiteral(args[0]) ?? readFirstString(args[0]);
        if (!uri) continue;
        routes.push({
          framework: 'laravel',
          methods: [callName === 'any' ? 'ANY' : callName.toUpperCase()],
          path: normalizeLaravelPath(uri, relPath),
          handler: parseLaravelHandler(args[1]),
          sourceFile: relPath,
          routeName,
        });
        continue;
      }

      if (callName === 'match') {
        const uri = readStringLiteral(args[1]) ?? readFirstString(args[1]);
        if (!uri) continue;
        routes.push({
          framework: 'laravel',
          methods: parseMatchMethods(args[0] ?? ''),
          path: normalizeLaravelPath(uri, relPath),
          handler: parseLaravelHandler(args[2]),
          sourceFile: relPath,
          routeName,
        });
        continue;
      }

      if (callName === 'apiResource') {
        const resource = readStringLiteral(args[0]) ?? readFirstString(args[0]);
        if (!resource) continue;
        const controller = parseLaravelHandler(args[1]);
        routes.push(...laravelResourceRoutes(resource, controller, relPath, routeName));
      }
    }
  }

  return { routes, routeFileCount: routeFiles.length, warnings: Array.from(new Set(warnings)) };
}

function normalizeNextSegment(segment: string): string | null {
  if (!segment || segment.startsWith('@')) return null;
  const normalized = segment.replace(/^(?:\([^)]*\))+/, '');
  return normalized || null;
}

function normalizeNextSegmentsToPath(segments: string[]): string {
  const visibleSegments = segments
    .map(normalizeNextSegment)
    .filter((segment): segment is string => Boolean(segment))
    .filter(segment => segment.toLowerCase() !== 'index');

  return normalizeRoutePath(visibleSegments.join('/'));
}

function normalizeNextPagesPath(relPath: string, prefix: string): string {
  const routePath = normalizeRelPath(relPath).slice(prefix.length).replace(NEXT_ROUTE_EXTENSIONS, '');
  return normalizeNextSegmentsToPath(routePath.split('/').filter(Boolean));
}

function normalizeNextAppPagePath(relPath: string, prefix: string): string {
  const routeDir = normalizeRelPath(relPath).slice(prefix.length).replace(/(?:^|\/)page\.(?:ts|tsx|js|jsx)$/i, '');
  return normalizeNextSegmentsToPath(routeDir.split('/').filter(Boolean));
}

function isNextPagesRouteFile(relPath: string): boolean {
  if (!(relPath.startsWith('pages/') || relPath.startsWith('src/pages/'))) return false;
  if (!NEXT_ROUTE_EXTENSIONS.test(relPath)) return false;

  const prefix = relPath.startsWith('src/pages/') ? 'src/pages/' : 'pages/';
  const relative = relPath.slice(prefix.length);
  if (!relative || relative.startsWith('api/')) return false;

  const fileName = basename(relative).replace(NEXT_ROUTE_EXTENSIONS, '');
  if (fileName.startsWith('_')) return false;
  if (fileName === '404' || fileName === '500') return false;
  return true;
}

function isNextAppPageFile(relPath: string): boolean {
  if (!(relPath.startsWith('app/') || relPath.startsWith('src/app/'))) return false;

  const prefix = relPath.startsWith('src/app/') ? 'src/app/' : 'app/';
  const relative = relPath.slice(prefix.length);
  return /(?:^|\/)page\.(?:ts|tsx|js|jsx)$/i.test(relative);
}

function parseNextRoutes(files: ApiSourceFile[]): { routes: ApiRouteEntry[]; routeFileCount: number } {
  const routes: ApiRouteEntry[] = [];
  const seenRouteFiles = new Set<string>();

  for (const file of files) {
    const relPath = normalizeRelPath(file.relPath);

    if (isNextPagesRouteFile(relPath)) {
      const prefix = relPath.startsWith('src/pages/') ? 'src/pages/' : 'pages/';
      seenRouteFiles.add(relPath);
      routes.push({
        framework: 'next-pages',
        methods: ['PAGE'],
        path: normalizeNextPagesPath(relPath, prefix),
        handler: 'page component',
        sourceFile: relPath,
        routeName: null,
      });
      continue;
    }

    if (isNextAppPageFile(relPath)) {
      const prefix = relPath.startsWith('src/app/') ? 'src/app/' : 'app/';
      seenRouteFiles.add(relPath);
      routes.push({
        framework: 'next-app',
        methods: ['PAGE'],
        path: normalizeNextAppPagePath(relPath, prefix),
        handler: 'page component',
        sourceFile: relPath,
        routeName: null,
      });
    }
  }

  return { routes, routeFileCount: seenRouteFiles.size };
}

function dedupeRoutes(routes: ApiRouteEntry[]): ApiRouteEntry[] {
  const byKey = new Map<string, ApiRouteEntry>();

  for (const route of routes) {
    const key = [route.framework, route.path, route.handler, route.sourceFile, route.routeName ?? ''].join('|');
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...route, methods: sortMethods(route.methods) });
      continue;
    }
    existing.methods = sortMethods([...existing.methods, ...route.methods]);
  }

  return Array.from(byKey.values())
    .sort((left, right) => left.path.localeCompare(right.path) || left.framework.localeCompare(right.framework) || left.handler.localeCompare(right.handler));
}

export function buildApiRouteOverview(files: ApiSourceFile[]): ApiRouteOverview {
  const normalizedFiles = files.map(file => ({ ...file, relPath: normalizeRelPath(file.relPath) }));
  const laravel = parseLaravelRoutes(normalizedFiles);
  const next = parseNextRoutes(normalizedFiles);
  const routes = dedupeRoutes([...laravel.routes, ...next.routes]);
  const frameworks = Array.from(new Set(routes.map(route => route.framework))) as Array<ApiRouteEntry['framework']>;

  return {
    frameworks,
    routes,
    laravelRouteFiles: laravel.routeFileCount,
    nextRouteFiles: next.routeFileCount,
    warnings: laravel.warnings,
  };
}