interface LaravelSourceFile {
  relPath: string;
  lang: string;
  total: number;
  code: number;
  content: string;
}

export interface LaravelSchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  indexed: boolean;
  unique: boolean;
  source: 'migration' | 'model';
}

export interface LaravelSchemaTable {
  name: string;
  columns: LaravelSchemaColumn[];
  migrationFiles: string[];
  modelClass: string | null;
  modelPath: string | null;
}

export interface LaravelSchemaRelation {
  sourceTable: string;
  targetTable: string;
  kind: 'foreign-key' | 'belongsTo' | 'hasOne' | 'hasMany' | 'belongsToMany' | 'morphOne' | 'morphMany' | 'morphToMany' | 'morphedByMany';
  label: string;
  sourceColumn: string | null;
  targetColumn: string | null;
  sourceModel: string | null;
  targetModel: string | null;
  sourceFile: string | null;
}

export interface LaravelSchemaGraph {
  isLaravel: boolean;
  detectedBy: string[];
  tables: LaravelSchemaTable[];
  relations: LaravelSchemaRelation[];
  migrationCount: number;
  modelCount: number;
  unresolvedModelRelations: number;
  warnings: string[];
}

interface ParsedModel {
  className: string;
  fqcn: string;
  relPath: string;
  table: string;
  namespace: string;
  uses: Map<string, string>;
  relationships: ParsedModelRelationship[];
}

interface ParsedModelRelationship {
  methodName: string;
  kind: LaravelSchemaRelation['kind'];
  targetClass: string | null;
  sourceColumn: string | null;
  targetColumn: string | null;
  pivotTable: string | null;
}

const SCHEMA_BLOCK_PATTERN = /Schema::(create|table)\s*\(\s*['"]([^'"]+)['"][\s\S]*?function\s*\([^)]*\)\s*(?:use\s*\([^)]*\)\s*)?\{([\s\S]*?)\n\s*\}\s*\);/g;
const TABLE_STATEMENT_PATTERN = /\$table->([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*([^;]*);/g;
const TEST_DIR_SEGMENTS = new Set(['tests', '__tests__', '__test__', 'spec', 'specs']);
const TEST_FILE_PATTERNS = [/Test\.php$/i, /Spec\.php$/i, /_test\.php$/i, /_spec\.php$/i];
const RELATIONSHIP_METHODS = new Set<LaravelSchemaRelation['kind']>([
  'belongsTo',
  'hasOne',
  'hasMany',
  'belongsToMany',
  'morphOne',
  'morphMany',
  'morphToMany',
  'morphedByMany',
]);
const NO_ARG_COLUMNS: Record<string, Array<{ name: string; type: string }>> = {
  id: [{ name: 'id', type: 'id' }],
  timestamps: [{ name: 'created_at', type: 'timestamp' }, { name: 'updated_at', type: 'timestamp' }],
  timestampsTz: [{ name: 'created_at', type: 'timestampTz' }, { name: 'updated_at', type: 'timestampTz' }],
  nullableTimestamps: [{ name: 'created_at', type: 'timestamp' }, { name: 'updated_at', type: 'timestamp' }],
  softDeletes: [{ name: 'deleted_at', type: 'timestamp' }],
  softDeletesTz: [{ name: 'deleted_at', type: 'timestampTz' }],
  rememberToken: [{ name: 'remember_token', type: 'string' }],
};
const COLUMN_METHODS = new Set([
  'bigIncrements',
  'bigInteger',
  'binary',
  'boolean',
  'char',
  'date',
  'dateTime',
  'dateTimeTz',
  'decimal',
  'double',
  'enum',
  'float',
  'foreignId',
  'foreignIdFor',
  'foreignUlid',
  'foreignUuid',
  'geometry',
  'id',
  'increments',
  'integer',
  'ipAddress',
  'json',
  'jsonb',
  'longText',
  'mediumIncrements',
  'mediumInteger',
  'mediumText',
  'morphs',
  'nullableMorphs',
  'nullableTimestamps',
  'rememberToken',
  'set',
  'smallIncrements',
  'smallInteger',
  'softDeletes',
  'softDeletesTz',
  'string',
  'text',
  'time',
  'timeTz',
  'timestamp',
  'timestamps',
  'timestampsTz',
  'tinyIncrements',
  'tinyInteger',
  'unsignedBigInteger',
  'unsignedInteger',
  'unsignedMediumInteger',
  'unsignedSmallInteger',
  'unsignedTinyInteger',
  'ulid',
  'uuid',
  'year',
]);

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function dirname(relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? '' : normalized.slice(0, lastSlash);
}

function basename(relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

function singular(value: string): string {
  if (value.endsWith('ies')) return `${value.slice(0, -3)}y`;
  if (value.endsWith('ses')) return value.slice(0, -2);
  if (value.endsWith('s') && !value.endsWith('ss')) return value.slice(0, -1);
  return value;
}

function plural(value: string): string {
  if (value.endsWith('y') && !/[aeiou]y$/i.test(value)) return `${value.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(value)) return `${value}es`;
  if (value.endsWith('s')) return value;
  return `${value}s`;
}

function defaultTableName(className: string): string {
  return plural(snakeCase(className));
}

function isTestFilePath(relPath: string): boolean {
  const normalized = normalizeRelPath(relPath);
  const segments = normalized.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] ?? normalized;
  if (segments.slice(0, -1).some(segment => TEST_DIR_SEGMENTS.has(segment.toLowerCase()))) return true;
  return TEST_FILE_PATTERNS.some(pattern => pattern.test(fileName));
}

function readStringLiteral(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^['"]([^'"]+)['"]$/);
  return match?.[1] ?? null;
}

function readFirstString(value: string): string | null {
  return value.match(/['"]([^'"]+)['"]/)?.[1] ?? null;
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

    if (char === '\'' || char === '"') {
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

function namedStringArg(args: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = args.match(new RegExp(`${escapedName}\\s*:\\s*['"]([^'"]+)['"]`));
  return match?.[1] ?? null;
}

function hasChain(chain: string, method: string): boolean {
  return new RegExp(`->${method}\\s*\\(`).test(chain);
}

function ensureTable(tables: Map<string, LaravelSchemaTable>, name: string): LaravelSchemaTable {
  const existing = tables.get(name);
  if (existing) return existing;
  const table: LaravelSchemaTable = {
    name,
    columns: [],
    migrationFiles: [],
    modelClass: null,
    modelPath: null,
  };
  tables.set(name, table);
  return table;
}

function addColumn(table: LaravelSchemaTable, column: LaravelSchemaColumn): void {
  const existing = table.columns.find(item => item.name === column.name);
  if (!existing) {
    table.columns.push(column);
    return;
  }

  existing.type = existing.type === 'unknown' ? column.type : existing.type;
  existing.nullable = existing.nullable || column.nullable;
  existing.indexed = existing.indexed || column.indexed;
  existing.unique = existing.unique || column.unique;
}

function addRelation(relations: Map<string, LaravelSchemaRelation>, relation: LaravelSchemaRelation): void {
  if (!relation.sourceTable || !relation.targetTable || relation.sourceTable === relation.targetTable) return;
  const key = [relation.sourceTable, relation.targetTable, relation.kind, relation.sourceColumn ?? '', relation.targetColumn ?? '', relation.sourceModel ?? '', relation.targetModel ?? ''].join('|');
  relations.set(key, relation);
}

function inferConstrainedTable(sourceColumn: string): string {
  return plural(sourceColumn.replace(/_id$/i, ''));
}

function classNameFromClassExpr(value: string): string | null {
  const normalized = value.trim().replace(/^\\/, '').replace(/::class\s*$/i, '').replace(/['"]/g, '');
  if (!normalized || normalized.includes('$')) return null;
  const parts = normalized.split('\\').filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

function columnNameForForeignIdFor(args: string): string | null {
  const className = classNameFromClassExpr(splitArgs(args)[0] ?? '');
  return className ? `${snakeCase(className)}_id` : null;
}

function addColumnsFromStatement(table: LaravelSchemaTable, method: string, args: string, chain: string): void {
  const nullable = hasChain(chain, 'nullable') || method === 'nullableMorphs' || method === 'nullableTimestamps';
  const indexed = hasChain(chain, 'index') || hasChain(chain, 'constrained') || method.startsWith('foreign') || method.endsWith('Morphs');
  const unique = hasChain(chain, 'unique');
  const firstArg = splitArgs(args)[0] ?? '';
  const firstString = readStringLiteral(firstArg) ?? readFirstString(firstArg);
  const noArgColumns = NO_ARG_COLUMNS[method];

  if (noArgColumns) {
    noArgColumns.forEach(column => addColumn(table, { ...column, nullable, indexed, unique, source: 'migration' }));
    return;
  }

  if (method === 'morphs' || method === 'nullableMorphs') {
    if (!firstString) return;
    addColumn(table, { name: `${firstString}_type`, type: 'string', nullable, indexed: true, unique, source: 'migration' });
    addColumn(table, { name: `${firstString}_id`, type: 'unsignedBigInteger', nullable, indexed: true, unique, source: 'migration' });
    return;
  }

  if (method === 'foreignIdFor') {
    const columnName = columnNameForForeignIdFor(args);
    if (!columnName) return;
    addColumn(table, { name: columnName, type: method, nullable, indexed: true, unique, source: 'migration' });
    return;
  }

  if (!COLUMN_METHODS.has(method) || !firstString) return;
  addColumn(table, { name: firstString, type: method, nullable, indexed, unique, source: 'migration' });
}

function parseConstrainedTable(args: string, sourceColumn: string): string | null {
  const constrainedMatch = args.match(/->constrained\s*\(([^)]*)\)/);
  if (!constrainedMatch) return null;
  const constrainedArgs = constrainedMatch[1] ?? '';
  return namedStringArg(constrainedArgs, 'table') ?? readFirstString(constrainedArgs) ?? inferConstrainedTable(sourceColumn);
}

function addMigrationRelations(tableName: string, migrationFile: string, method: string, args: string, chain: string, relations: Map<string, LaravelSchemaRelation>): void {
  const firstArg = splitArgs(args)[0] ?? '';
  const firstString = readStringLiteral(firstArg) ?? readFirstString(firstArg);
  const explicitForeignColumn = method === 'foreign' ? firstString : null;
  const sourceColumn = explicitForeignColumn ?? (method === 'foreignIdFor' ? columnNameForForeignIdFor(args) : firstString);
  if (!sourceColumn) return;

  const targetColumn = chain.match(/->references\s*\(\s*['"]([^'"]+)['"]\s*\)/)?.[1] ?? 'id';
  const onTable = chain.match(/->on\s*\(\s*['"]([^'"]+)['"]\s*\)/)?.[1] ?? null;
  const constrainedTable = parseConstrainedTable(chain, sourceColumn);
  let targetTable = onTable ?? constrainedTable;

  if (!targetTable && method === 'foreignIdFor') {
    const targetClassName = classNameFromClassExpr(splitArgs(args)[0] ?? '');
    targetTable = targetClassName ? defaultTableName(targetClassName) : null;
  }

  if (!targetTable && method.startsWith('foreign') && sourceColumn.endsWith('_id')) {
    targetTable = inferConstrainedTable(sourceColumn);
  }

  if (!targetTable) return;
  addRelation(relations, {
    sourceTable: tableName,
    targetTable,
    kind: 'foreign-key',
    label: `${sourceColumn} -> ${targetTable}.${targetColumn}`,
    sourceColumn,
    targetColumn,
    sourceModel: null,
    targetModel: null,
    sourceFile: migrationFile,
  });
}

function parseMigrations(files: LaravelSourceFile[], tables: Map<string, LaravelSchemaTable>, relations: Map<string, LaravelSchemaRelation>): number {
  let migrationCount = 0;

  for (const file of files) {
    const relPath = normalizeRelPath(file.relPath);
    if (!relPath.startsWith('database/migrations/') || !relPath.endsWith('.php')) continue;
    migrationCount += 1;

    SCHEMA_BLOCK_PATTERN.lastIndex = 0;
    let blockMatch = SCHEMA_BLOCK_PATTERN.exec(file.content);
    while (blockMatch) {
      const tableName = blockMatch[2];
      const body = blockMatch[3] ?? '';
      const table = ensureTable(tables, tableName);
      if (!table.migrationFiles.includes(relPath)) table.migrationFiles.push(relPath);

      TABLE_STATEMENT_PATTERN.lastIndex = 0;
      let statementMatch = TABLE_STATEMENT_PATTERN.exec(body);
      while (statementMatch) {
        const method = statementMatch[1];
        const args = statementMatch[2] ?? '';
        const chain = statementMatch[3] ?? '';
        addColumnsFromStatement(table, method, args, chain);
        addMigrationRelations(tableName, relPath, method, args, chain, relations);
        statementMatch = TABLE_STATEMENT_PATTERN.exec(body);
      }

      blockMatch = SCHEMA_BLOCK_PATTERN.exec(file.content);
    }
  }

  return migrationCount;
}

function phpNamespace(content: string): string {
  return content.match(/^\s*namespace\s+([^;]+);/m)?.[1]?.trim().replace(/\\+$/, '') ?? '';
}

function expandPhpUseStatement(statement: string): string[] {
  const normalized = statement.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.startsWith('function ') || normalized.startsWith('const ')) return [];
  const groupStart = normalized.indexOf('{');
  const groupEnd = normalized.lastIndexOf('}');

  if (groupStart !== -1 && groupEnd > groupStart && normalized[groupStart - 1] === '\\') {
    const prefix = normalized.slice(0, groupStart - 1).replace(/^\\+|\\+$/g, '');
    return normalized.slice(groupStart + 1, groupEnd).split(',')
      .map(part => `${prefix}\\${part.trim().replace(/\s+as\s+[A-Za-z_][A-Za-z0-9_]*$/i, '')}`)
      .filter(Boolean);
  }

  return normalized.split(',').map(part => part.trim()).filter(Boolean);
}

function phpUses(content: string): Map<string, string> {
  const uses = new Map<string, string>();
  const usePattern = /^\s*use\s+([\s\S]*?);/gm;
  let match = usePattern.exec(content);

  while (match) {
    for (const item of expandPhpUseStatement(match[1] ?? '')) {
      const aliasMatch = item.match(/\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i);
      const fqcn = item.replace(/\s+as\s+[A-Za-z_][A-Za-z0-9_]*$/i, '').replace(/^\\+/, '').trim();
      const alias = aliasMatch?.[1] ?? fqcn.split('\\').filter(Boolean).pop();
      if (alias && fqcn) uses.set(alias, fqcn);
    }
    match = usePattern.exec(content);
  }

  return uses;
}

function modelClassName(content: string): { className: string; extendsName: string | null } | null {
  const match = content.match(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:extends\s+([^\s{]+))?/);
  if (!match?.[1]) return null;
  return { className: match[1], extendsName: match[2] ?? null };
}

function isModelFile(file: LaravelSourceFile, classInfo: { className: string; extendsName: string | null } | null): boolean {
  const relPath = normalizeRelPath(file.relPath);
  if (!relPath.endsWith('.php') || !classInfo) return false;
  if (isTestFilePath(relPath)) return false;
  if (!/^app\/.+\.php$/.test(relPath)) return false;
  if (/^app\/Models\/.+\.php$/.test(relPath)) return true;
  return /(?:^|\\)(Model|Authenticatable)$/.test(classInfo.extendsName ?? '');
}

function formatModelRelationLabel(relation: ParsedModelRelationship, sourceTable: string, targetTable: string): string {
  if (relation.kind === 'belongsTo') {
    return `${relation.kind}: ${sourceTable}.${relation.sourceColumn ?? '?'} -> ${targetTable}.${relation.targetColumn ?? 'id'}`;
  }
  if (relation.kind === 'hasOne' || relation.kind === 'hasMany') {
    return `${relation.kind}: ${sourceTable}.${relation.targetColumn ?? 'id'} -> ${targetTable}.${relation.sourceColumn ?? '?'}`;
  }
  if (relation.pivotTable) return `${relation.kind}: ${sourceTable} <-> ${targetTable} via ${relation.pivotTable}`;
  return relation.kind;
}

function resolveClassReference(value: string | undefined, namespace: string, uses: Map<string, string>): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/::class\s*$/i, '').replace(/^['"]|['"]$/g, '').replace(/^\\+/, '');
  if (!trimmed || trimmed.includes('$') || trimmed === 'self' || trimmed === 'static') return null;

  const parts = trimmed.split('\\').filter(Boolean);
  const head = parts[0];
  if (!head) return null;

  const used = uses.get(head);
  if (used) return [used, ...parts.slice(1)].join('\\');
  if (trimmed.includes('\\')) return trimmed;
  return namespace ? `${namespace}\\${trimmed}` : trimmed;
}

function parseRelationshipArgs(methodName: string, kind: LaravelSchemaRelation['kind'], args: string, namespace: string, uses: Map<string, string>, sourceTable: string): ParsedModelRelationship | null {
  if (!RELATIONSHIP_METHODS.has(kind)) return null;
  const parts = splitArgs(args);
  const targetClass = kind === 'morphOne' || kind === 'morphMany' || kind === 'morphToMany' || kind === 'morphedByMany' || kind === 'belongsToMany'
    ? resolveClassReference(parts[0], namespace, uses)
    : kind === 'belongsTo' || kind === 'hasOne' || kind === 'hasMany'
      ? resolveClassReference(parts[0], namespace, uses)
      : null;

  if (!targetClass) return null;

  if (kind === 'belongsTo') {
    return {
      methodName,
      kind,
      targetClass,
      sourceColumn: readStringLiteral(parts[1]) ?? `${snakeCase(methodName)}_id`,
      targetColumn: readStringLiteral(parts[2]) ?? 'id',
      pivotTable: null,
    };
  }

  if (kind === 'hasOne' || kind === 'hasMany') {
    return {
      methodName,
      kind,
      targetClass,
      sourceColumn: readStringLiteral(parts[1]) ?? `${singular(sourceTable)}_id`,
      targetColumn: readStringLiteral(parts[2]) ?? 'id',
      pivotTable: null,
    };
  }

  return {
    methodName,
    kind,
    targetClass,
    sourceColumn: readStringLiteral(parts[2]) ?? null,
    targetColumn: readStringLiteral(parts[3]) ?? null,
    pivotTable: readStringLiteral(parts[1]) ?? null,
  };
}

function parseModelRelationships(content: string, namespace: string, uses: Map<string, string>, sourceTable: string): ParsedModelRelationship[] {
  const relationships: ParsedModelRelationship[] = [];
  const methodPattern = /function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)[^{]*\{([\s\S]*?return\s+\$this->[A-Za-z_][A-Za-z0-9_]*\s*\([\s\S]*?;)[\s\S]*?\}/g;
  let methodMatch = methodPattern.exec(content);

  while (methodMatch) {
    const methodName = methodMatch[1];
    const body = methodMatch[2] ?? '';
    const relationMatch = body.match(/\$this->([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)/);
    const kind = relationMatch?.[1] as LaravelSchemaRelation['kind'] | undefined;
    if (kind) {
      const relationship = parseRelationshipArgs(methodName, kind, relationMatch?.[2] ?? '', namespace, uses, sourceTable);
      if (relationship) relationships.push(relationship);
    }
    methodMatch = methodPattern.exec(content);
  }

  return relationships;
}

function parseModels(files: LaravelSourceFile[]): ParsedModel[] {
  const models: ParsedModel[] = [];

  for (const file of files) {
    const classInfo = modelClassName(file.content);
    if (!isModelFile(file, classInfo)) continue;

    const namespace = phpNamespace(file.content);
    const uses = phpUses(file.content);
    const className = classInfo!.className;
    const table = file.content.match(/protected\s+\$table\s*=\s*['"]([^'"]+)['"]\s*;/)?.[1] ?? defaultTableName(className);
    const fqcn = namespace ? `${namespace}\\${className}` : className;

    models.push({
      className,
      fqcn,
      relPath: normalizeRelPath(file.relPath),
      table,
      namespace,
      uses,
      relationships: parseModelRelationships(file.content, namespace, uses, table),
    });
  }

  return models;
}

function addModelRelations(models: ParsedModel[], tables: Map<string, LaravelSchemaTable>, relations: Map<string, LaravelSchemaRelation>): number {
  const modelsByFqcn = new Map(models.map(model => [model.fqcn, model]));
  let unresolvedModelRelations = 0;

  for (const model of models) {
    const table = ensureTable(tables, model.table);
    table.modelClass = model.fqcn;
    table.modelPath = model.relPath;

    for (const relationship of model.relationships) {
      const targetModel = relationship.targetClass ? modelsByFqcn.get(relationship.targetClass) : null;
      if (!targetModel) unresolvedModelRelations += 1;
      const targetTable = targetModel?.table ?? (relationship.targetClass ? defaultTableName(relationship.targetClass.split('\\').pop() ?? relationship.targetClass) : null);
      if (!targetTable) continue;

      ensureTable(tables, targetTable);
      addRelation(relations, {
        sourceTable: model.table,
        targetTable,
        kind: relationship.kind,
        label: formatModelRelationLabel(relationship, model.table, targetTable),
        sourceColumn: relationship.sourceColumn,
        targetColumn: relationship.targetColumn,
        sourceModel: model.fqcn,
        targetModel: relationship.targetClass,
        sourceFile: model.relPath,
      });
    }
  }

  return unresolvedModelRelations;
}

function detectLaravel(files: LaravelSourceFile[], migrationCount: number, modelCount: number): string[] {
  const detectedBy: string[] = [];
  const composer = files.find(file => normalizeRelPath(file.relPath) === 'composer.json');

  if (composer && /"laravel\/framework"/.test(composer.content)) detectedBy.push('composer:laravel/framework');
  if (files.some(file => normalizeRelPath(file.relPath) === 'artisan' && /Illuminate\\Foundation\\Console\\Kernel/.test(file.content))) detectedBy.push('artisan');
  if (files.some(file => normalizeRelPath(file.relPath) === 'bootstrap/app.php')) detectedBy.push('bootstrap/app.php');
  if (migrationCount > 0) detectedBy.push('database/migrations');
  if (modelCount > 0) detectedBy.push('eloquent-models');

  return Array.from(new Set(detectedBy));
}

export function buildLaravelSchemaGraph(files: LaravelSourceFile[]): LaravelSchemaGraph {
  const normalizedFiles = files.map(file => ({ ...file, relPath: normalizeRelPath(file.relPath) }));
  const tables = new Map<string, LaravelSchemaTable>();
  const relations = new Map<string, LaravelSchemaRelation>();
  const migrationCount = parseMigrations(normalizedFiles, tables, relations);
  const models = parseModels(normalizedFiles);
  const unresolvedModelRelations = addModelRelations(models, tables, relations);
  const detectedBy = detectLaravel(normalizedFiles, migrationCount, models.length);

  const sortedTables = Array.from(tables.values())
    .map(table => ({
      ...table,
      columns: [...table.columns].sort((left, right) => {
        if (left.name === 'id') return -1;
        if (right.name === 'id') return 1;
        return left.name.localeCompare(right.name);
      }),
      migrationFiles: [...table.migrationFiles].sort(),
    }))
    .sort((left, right) => right.columns.length - left.columns.length || left.name.localeCompare(right.name));

  const sortedRelations = Array.from(relations.values())
    .sort((left, right) => left.sourceTable.localeCompare(right.sourceTable) || left.targetTable.localeCompare(right.targetTable) || left.kind.localeCompare(right.kind));

  return {
    isLaravel: detectedBy.length > 0,
    detectedBy,
    tables: sortedTables,
    relations: sortedRelations,
    migrationCount,
    modelCount: models.length,
    unresolvedModelRelations,
    warnings: unresolvedModelRelations > 0 ? [`${unresolvedModelRelations} model relations could not be resolved to scanned model files.`] : [],
  };
}