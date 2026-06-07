import pg from 'pg';
import { getSettings } from './settings.js';
import type { Principal } from './types.js';

export interface ExecuteOptions {
  dryRun?: boolean;
}

export async function executeSql(
  targetDsn: string,
  sql: string,
  principal: Principal,
  opts: ExecuteOptions = {},
): Promise<Array<Record<string, unknown>>> {
  const s = getSettings();
  const client = new pg.Client({ connectionString: targetDsn });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${Number.parseInt(String(s.statementTimeoutMs), 10)}`);

    if (principal.tenant_id) {
      await client.query("SELECT set_config('nl2sql.tenant_id', $1, true)", [principal.tenant_id]);
    }
    await client.query("SELECT set_config('nl2sql.user_id', $1, true)", [principal.user_id]);

    if (opts.dryRun) {
      await client.query(`EXPLAIN ${sql}`);
      await client.query('COMMIT');
      return [];
    }

    const { rows } = await client.query(sql);
    await client.query('COMMIT');
    return rows.map((r) => jsonable(r));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}

function jsonable(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = coerce(v);
  }
  return out;
}

function coerce(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Buffer) return v.toString('hex');
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(coerce);
  if (typeof v === 'object') return jsonable(v as Record<string, unknown>);
  return v;
}
