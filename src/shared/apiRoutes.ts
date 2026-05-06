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

interface LaravelRouteContext {
  pathPrefix: string;
  controller: string | null;
  namePrefix: string;
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

function dirname(relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? '' : normalized.slice(0, lastSlash);
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

function findMatchingBrace(value: string, openIndex: number): number {
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

    if (char === '{') depth += 1;
    if (char === '}') {
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

type LaravelChainCall = {
  callName: string;
  args: string;
};

function trimLaravelRouteSegment(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '');
}

function joinLaravelRouteSegments(prefix: string, segment: string | null): string {
  const normalizedPrefix = trimLaravelRouteSegment(prefix);
  const normalizedSegment = trimLaravelRouteSegment(segment ?? '');

  if (!normalizedPrefix) return normalizedSegment;
  if (!normalizedSegment) return normalizedPrefix;
  return `${normalizedPrefix}/${normalizedSegment}`;
}

function combineLaravelRoutePath(prefix: string, routePath: string): string {
  const normalizedRoutePath = routePath.trim();
  if (!prefix) return normalizedRoutePath;
  if (!normalizedRoutePath || normalizedRoutePath === '/') return prefix;
  return joinLaravelRouteSegments(prefix, normalizedRoutePath);
}

function parseLaravelController(value: string | undefined): string | null {
  if (!value) return null;

  const classHandler = value.match(/([A-Za-z0-9_\\]+)::class/);
  if (classHandler?.[1]) return classHandler[1];

  const literal = readStringLiteral(value);
  if (literal && !literal.includes('@')) return literal;
  return null;
}

function resolveLaravelRouteHandler(value: string | undefined, controller: string | null): string {
  const literal = readStringLiteral(value);
  if (controller && literal && !literal.includes('@') && !literal.includes('\\')) return `${controller}@${literal}`;
  return parseLaravelHandler(value);
}

function parseLaravelNameSegment(value: string | undefined): string {
  return readStringLiteral(value) ?? readFirstString(value) ?? '';
}

function collectLaravelChainCalls(statement: string): LaravelChainCall[] {
  const header = statement.match(/^Route::([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  if (!header?.[1]) return [];

  const openIndex = statement.indexOf('(', header[0].length - 1);
  if (openIndex === -1) return [];

  const closeIndex = findMatchingParen(statement, openIndex);
  if (closeIndex === -1) return [];

  const calls: LaravelChainCall[] = [{
    callName: header[1].toLowerCase(),
    args: statement.slice(openIndex + 1, closeIndex),
  }];

  let cursor = closeIndex + 1;

  while (cursor < statement.length) {
    while (/\s/.test(statement[cursor] ?? '')) cursor += 1;
    if (statement[cursor] !== '-' || statement[cursor + 1] !== '>') {
      cursor += 1;
      continue;
    }

    cursor += 2;
    while (/\s/.test(statement[cursor] ?? '')) cursor += 1;

    const nameMatch = statement.slice(cursor).match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (!nameMatch?.[1]) break;

    const chainOpenIndex = statement.indexOf('(', cursor + nameMatch[1].length - 1);
    if (chainOpenIndex === -1) break;

    const chainCloseIndex = findMatchingParen(statement, chainOpenIndex);
    if (chainCloseIndex === -1) break;

    calls.push({
      callName: nameMatch[1].toLowerCase(),
      args: statement.slice(chainOpenIndex + 1, chainCloseIndex),
    });
    cursor = chainCloseIndex + 1;
  }

  return calls;
}

function extractLaravelClosureBody(value: string): string | null {
  const functionIndex = value.search(/\bfunction\b/);
  if (functionIndex === -1) return null;

  const openBraceIndex = value.indexOf('{', functionIndex);
  if (openBraceIndex === -1) return null;

  const closeBraceIndex = findMatchingBrace(value, openBraceIndex);
  if (closeBraceIndex === -1) return null;

  return value.slice(openBraceIndex + 1, closeBraceIndex);
}

function parseLaravelGroupContext(args: string): Partial<LaravelRouteContext> {
  const configArg = splitArgs(args).find(arg => /^\s*(?:\[|array\s*\()/i.test(arg));
  if (!configArg) return {};

  const prefix = configArg.match(/['"`]prefix['"`]\s*=>\s*['"`]([^'"`]+)['"`]/)?.[1] ?? '';
  const namePrefix = configArg.match(/['"`](?:as|name)['"`]\s*=>\s*['"`]([^'"`]+)['"`]/)?.[1] ?? '';
  const controller = configArg.match(/['"`]controller['"`]\s*=>\s*([A-Za-z0-9_\\]+)::class/)?.[1] ?? null;

  return {
    pathPrefix: prefix,
    controller,
    namePrefix,
  };
}

function resolveLaravelRouteName(baseNamePrefix: string, pendingName: string, tailCalls: LaravelChainCall[]): string | null {
  const tailName = tailCalls
    .filter(call => call.callName === 'name' || call.callName === 'as')
    .map(call => parseLaravelNameSegment(call.args))
    .join('');

  const localName = `${pendingName}${tailName}`;
  if (!localName) return null;
  return `${baseNamePrefix}${localName}`;
}

function collectLaravelRoutesFromContent(content: string, sourceFile: string, context: LaravelRouteContext): ApiRouteEntry[] {
  const routes: ApiRouteEntry[] = [];

  for (const statement of collectLaravelRouteStatements(content)) {
    const calls = collectLaravelChainCalls(statement);
    if (calls.length === 0) continue;

    let pathPrefix = context.pathPrefix;
    let controller = context.controller;
    let pendingName = '';

    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index];
      const args = splitArgs(call.args);

      if (call.callName === 'prefix') {
        pathPrefix = joinLaravelRouteSegments(pathPrefix, parseLaravelNameSegment(args[0]));
        continue;
      }

      if (call.callName === 'controller') {
        controller = parseLaravelController(args[0]) ?? controller;
        continue;
      }

      if (call.callName === 'name' || call.callName === 'as') {
        pendingName += parseLaravelNameSegment(args[0]);
        continue;
      }

      if (call.callName === 'group') {
        const groupContext = parseLaravelGroupContext(call.args);
        const body = extractLaravelClosureBody(call.args);
        if (!body) break;

        routes.push(...collectLaravelRoutesFromContent(body, sourceFile, {
          pathPrefix: joinLaravelRouteSegments(pathPrefix, groupContext.pathPrefix ?? ''),
          controller: groupContext.controller ?? controller,
          namePrefix: `${context.namePrefix}${pendingName}${groupContext.namePrefix ?? ''}`,
        }));
        break;
      }

      if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'any'].includes(call.callName)) {
        const uri = readStringLiteral(args[0]) ?? readFirstString(args[0]);
        if (!uri) break;

        routes.push({
          framework: 'laravel',
          methods: [call.callName === 'any' ? 'ANY' : call.callName.toUpperCase()],
          path: normalizeLaravelPath(combineLaravelRoutePath(pathPrefix, uri), sourceFile),
          handler: resolveLaravelRouteHandler(args[1], controller),
          sourceFile,
          routeName: resolveLaravelRouteName(context.namePrefix, pendingName, calls.slice(index + 1)),
        });
        break;
      }

      if (call.callName === 'match') {
        const uri = readStringLiteral(args[1]) ?? readFirstString(args[1]);
        if (!uri) break;

        routes.push({
          framework: 'laravel',
          methods: parseMatchMethods(args[0] ?? ''),
          path: normalizeLaravelPath(combineLaravelRoutePath(pathPrefix, uri), sourceFile),
          handler: resolveLaravelRouteHandler(args[2], controller),
          sourceFile,
          routeName: resolveLaravelRouteName(context.namePrefix, pendingName, calls.slice(index + 1)),
        });
        break;
      }

      if (call.callName === 'apiresource') {
        const resource = readStringLiteral(args[0]) ?? readFirstString(args[0]);
        if (!resource) break;

        const resourceController = parseLaravelHandler(args[1]) || controller || 'Closure';
        routes.push(...laravelResourceRoutes(
          combineLaravelRoutePath(pathPrefix, resource),
          resourceController,
          sourceFile,
          resolveLaravelRouteName(context.namePrefix, pendingName, calls.slice(index + 1)),
        ));
        break;
      }
    }
  }

  return routes;
}

function resolveLaravelIncludePath(sourceFile: string, expression: string): string | null {
  const basePathMatch = expression.match(/base_path\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
  if (basePathMatch?.[1]) return normalizeRelPath(basePathMatch[1]);

  const dirMatch = expression.match(/__DIR__\s*\.\s*['"`]\/?([^'"`]+)['"`]/);
  if (dirMatch?.[1]) return normalizeRelPath(`${dirname(sourceFile)}/${dirMatch[1]}`);

  const literalPath = readStringLiteral(expression) ?? readFirstString(expression);
  if (!literalPath) return null;
  if (literalPath.startsWith('/')) return normalizeRelPath(literalPath);
  return normalizeRelPath(`${dirname(sourceFile)}/${literalPath}`);
}

function collectLaravelRequiredRouteFiles(content: string, sourceFile: string): string[] {
  const required = new Set<string>();
  const patterns = [
    /\b(?:require|require_once|include|include_once)\s*\(?\s*(base_path\s*\(\s*['"`][^'"`]+['"`]\s*\))\s*\)?\s*;/g,
    /\b(?:require|require_once|include|include_once)\s*\(?\s*(__DIR__\s*\.\s*['"`]\/?[^'"`]+['"`])\s*\)?\s*;/g,
    /\b(?:require|require_once|include|include_once)\s*\(?\s*(['"`][^'"`]+['"`])\s*\)?\s*;/g,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(content);
    while (match) {
      const resolved = resolveLaravelIncludePath(sourceFile, match[1] ?? '');
      if (resolved?.endsWith('.php')) required.add(resolved);
      match = pattern.exec(content);
    }
  }

  return Array.from(required);
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
  const directRouteFiles = files.filter(file => {
    const relPath = normalizeRelPath(file.relPath);
    return relPath === 'routes/api.php' || relPath.startsWith('routes/api/') && relPath.endsWith('.php');
  });
  const routeFileMap = new Map(directRouteFiles.map(file => [normalizeRelPath(file.relPath), { ...file, relPath: normalizeRelPath(file.relPath) }]));
  const visitedRouteFiles = new Set<string>();
  const missingIncludedFiles = new Set<string>();
  const routeFiles: ApiSourceFile[] = [];
  const routes: ApiRouteEntry[] = [];
  const warnings: string[] = [];

  function visitRouteFile(relPath: string) {
    const normalizedRelPath = normalizeRelPath(relPath);
    if (visitedRouteFiles.has(normalizedRelPath)) return;

    const routeFile = routeFileMap.get(normalizedRelPath);
    if (!routeFile) {
      missingIncludedFiles.add(normalizedRelPath);
      return;
    }

    visitedRouteFiles.add(normalizedRelPath);
    routeFiles.push(routeFile);

    for (const includedRouteFile of collectLaravelRequiredRouteFiles(routeFile.content, normalizedRelPath)) {
      visitRouteFile(includedRouteFile);
    }
  }

  if (routeFileMap.has('routes/api.php')) visitRouteFile('routes/api.php');
  for (const relPath of routeFileMap.keys()) visitRouteFile(relPath);

  if (missingIncludedFiles.size > 0) {
    warnings.push(`Laravel included route files were referenced but not found in the scan: ${Array.from(missingIncludedFiles).sort().join(', ')}`);
  }

  for (const file of routeFiles) {
    const relPath = normalizeRelPath(file.relPath);
    if (/Route::(?:prefix|controller|middleware|name|group)\s*\(/.test(file.content) || /->group\s*\(/.test(file.content)) {
      warnings.push('Laravel route groups are expanded best-effort; dynamic group attributes or runtime-defined routes can still be incomplete.');
    }

    routes.push(...collectLaravelRoutesFromContent(file.content, relPath, {
      pathPrefix: '',
      controller: null,
      namePrefix: '',
    }));
  }

  return { routes, routeFileCount: visitedRouteFiles.size, warnings: Array.from(new Set(warnings)) };
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