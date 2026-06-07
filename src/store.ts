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
    await client.query(`
      CREATE TABLE IF NOT EXISTS ingests (
        ingest_id     TEXT PRIMARY KEY,
        target_dsn    TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS chunks (
        id            BIGSERIAL PRIMARY KEY,
        ingest_id     TEXT NOT NULL REFERENCES ingests(ingest_id) ON DELETE CASCADE,
        kind          TEXT NOT NULL,
        ref           TEXT,
        content       TEXT NOT NULL,
        metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
        embedding     vector(${embedDim}) NOT NULL
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS chunks_ingest_kind_idx ON chunks (ingest_id, kind);');
  } finally {
    client.release();
  }
}

export async function writeIngest(
  ingestId: string,
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
      `INSERT INTO ingests (ingest_id, target_dsn) VALUES ($1, $2)
       ON CONFLICT (ingest_id) DO UPDATE SET target_dsn = EXCLUDED.target_dsn`,
      [ingestId, targetDsn],
    );
    await client.query('DELETE FROM chunks WHERE ingest_id = $1', [ingestId]);
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      const emb = embeddings[i]!;
      await client.query(
        `INSERT INTO chunks (ingest_id, kind, ref, content, metadata, embedding)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::vector)`,
        [ingestId, c.kind, c.ref, c.content, JSON.stringify(c.metadata ?? {}), vecLiteral(emb)],
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

export async function getTargetDsn(ingestId: string): Promise<string | null> {
  const p = await getPool();
  const { rows } = await p.query<{ target_dsn: string }>(
    'SELECT target_dsn FROM ingests WHERE ingest_id = $1',
    [ingestId],
  );
  return rows[0]?.target_dsn ?? null;
}

export async function searchChunks(
  ingestId: string,
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
    distance: number;
  }>(
    `SELECT kind, ref, content, metadata, embedding <=> $1::vector AS distance
     FROM chunks
     WHERE ingest_id = $2 AND kind = $3
     ORDER BY embedding <=> $1::vector
     LIMIT $4`,
    [vecLiteral(embedding), ingestId, kind, k],
  );
  return rows.map((r) => ({
    kind: r.kind,
    ref: r.ref,
    content: r.content,
    metadata: r.metadata,
    distance: r.distance,
  }));
}

function vecLiteral(v: number[]): string {
  return '[' + v.map((x) => x.toFixed(7)).join(',') + ']';
}
