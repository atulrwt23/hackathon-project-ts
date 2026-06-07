import pkg from 'node-sql-parser';
const { Parser } = pkg;

export class SQLValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SQLValidationError';
  }
}

const FORBIDDEN_TYPES = new Set([
  'insert', 'update', 'delete', 'replace', 'merge',
  'create', 'drop', 'alter', 'truncate', 'grant', 'revoke',
  'rename', 'use', 'set', 'show', 'call', 'copy',
]);

const parser = new Parser();

export function validateAndCap(rawSql: string, maxRows: number): string {
  const sql = rawSql.trim().replace(/;\s*$/, '').trim();
  if (!sql) throw new SQLValidationError('empty SQL');

  let ast: unknown;
  try {
    ast = parser.astify(sql, { database: 'postgresql' });
  } catch (e) {
    throw new SQLValidationError(`unparseable SQL: ${(e as Error).message}`);
  }

  const statements = (Array.isArray(ast) ? ast : [ast]) as Array<{ type?: string }>;
  if (statements.length !== 1) {
    throw new SQLValidationError(`exactly one statement required, got ${statements.length}`);
  }

  const root = statements[0]!;
  if (root.type !== 'select') {
    throw new SQLValidationError(
      `only SELECT/WITH/UNION allowed at top level, got ${root.type ?? 'unknown'}`,
    );
  }

  walkAndReject(root);

  return `SELECT * FROM (${sql}) AS nl2sql_capped LIMIT ${maxRows}`;
}

function walkAndReject(node: unknown): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) walkAndReject(item);
    return;
  }
  if (typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;
  const type = obj.type;
  if (typeof type === 'string' && FORBIDDEN_TYPES.has(type)) {
    throw new SQLValidationError(`forbidden statement type: ${type}`);
  }
  for (const value of Object.values(obj)) {
    walkAndReject(value);
  }
}
