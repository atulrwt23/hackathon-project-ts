import pg from 'pg';
import type { Chunk, RetrievedChunk } from './types.js';
import { getSettings } from './settings.js';

let pool: pg.Pool | null = null;
let schemaInitDone = false;

export async function getPool(): Promise<pg.Pool> {
  if (pool) return pool;
  const s = getSettings();
  pool = new pg.Pool({ connectionString: s.metadataDsn, min: 1, max: 10 });
  if (!schemaInitDone) {
    await initSchema(pool, s.embedDim);
    schemaInitDone = true;
  }
  return pool;
}

async function initSchema(p: pg.Pool, embedDim: number): Promise<void> {
  const client = await p.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');

    // projects: one row per (account, project), holds the target DSN
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        account_id   TEXT NOT NULL,
        project_id   TEXT NOT NULL,
        target_dsn   TEXT NOT NULL,
        ingested_at  TIMESTAMPTZ,
        PRIMARY KEY (account_id, project_id)
      );
    `);

    // chunks: all embedded pieces of knowledge for every project
    await client.query(`
      CREATE TABLE IF NOT EXISTS chunks (
        id           BIGSERIAL PRIMARY KEY,
        account_id   TEXT NOT NULL,
        project_id   TEXT NOT NULL,
        kind         TEXT NOT NULL,
        ref          TEXT,
        content      TEXT NOT NULL,
        metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
        embedding    vector(${embedDim}) NOT NULL,
        FOREIGN KEY (account_id, project_id)
          REFERENCES projects(account_id, project_id) ON DELETE CASCADE
      );
    `);

    // Primary query pattern: WHERE account_id = ? AND kind = ? ORDER BY embedding <=> ?
    await client.query(
      'CREATE INDEX IF NOT EXISTS chunks_account_kind_idx ON chunks (account_id, kind);',
    );
  } finally {
    client.release();
  }
}

// writeProject upserts the project record and atomically replaces all its chunks.
// Calling it again is safe and idempotent (re-ingest).
export async function writeProject(
  accountId: string,
  projectId: string,
  targetDsn: string,
  chunks: Chunk[],
  embeddings: number[][],
): Promise<void> {
  if (chunks.length !== embeddings.length) {
    throw new Error(`chunks/embeddings length mismatch: ${chunks.length} vs ${embeddings.length}`);
  }
  const p = await getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO projects (account_id, project_id, target_dsn, ingested_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (account_id, project_id)
       DO UPDATE SET target_dsn = EXCLUDED.target_dsn, ingested_at = now()`,
      [accountId, projectId, targetDsn],
    );

    // Replace all chunks for this project (re-ingest is always a full refresh)
    await client.query('DELETE FROM chunks WHERE account_id = $1 AND project_id = $2', [
      accountId,
      projectId,
    ]);

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      const emb = embeddings[i]!;
      await client.query(
        `INSERT INTO chunks (account_id, project_id, kind, ref, content, metadata, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::vector)`,
        [accountId, projectId, c.kind, c.ref, c.content, JSON.stringify(c.metadata ?? {}), vecLiteral(emb)],
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

// searchChunks searches across ALL projects of an account.
// The project_id on each returned chunk tells the caller which DB to execute against.
export async function searchChunks(
  accountId: string,
  embedding: number[],
  kind: string,
  k: number,
): Promise<RetrievedChunk[]> {
  const p = await getPool();
  const { rows } = await p.query<{
    kind: string;
    ref: string | null;
    content: string;
    metadata: Record<string, unknown>;
    project_id: string;
    distance: number;
  }>(
    `SELECT kind, ref, content, metadata, project_id,
            embedding <=> $1::vector AS distance
     FROM chunks
     WHERE account_id = $2 AND kind = $3
     ORDER BY embedding <=> $1::vector
     LIMIT $4`,
    [vecLiteral(embedding), accountId, kind, k],
  );
  return rows.map((r) => ({
    kind: r.kind,
    ref: r.ref,
    content: r.content,
    metadata: r.metadata,
    project_id: r.project_id,
    distance: r.distance,
  }));
}

export async function getProjectDsn(accountId: string, projectId: string): Promise<string | null> {
  const p = await getPool();
  const { rows } = await p.query<{ target_dsn: string }>(
    'SELECT target_dsn FROM projects WHERE account_id = $1 AND project_id = $2',
    [accountId, projectId],
  );
  return rows[0]?.target_dsn ?? null;
}

function vecLiteral(v: number[]): string {
  return '[' + v.map((x) => x.toFixed(7)).join(',') + ']';
}
