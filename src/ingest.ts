import pg from 'pg';
import { embedTexts } from './embeddings.js';
import * as store from './store.js';
import { getSettings } from './settings.js';
import { loadProjectConfig, loadContextFile } from './context-parser.js';
import type { BusinessContext, Chunk, IngestRequest, IngestResponse } from './types.js';

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface FkRow {
  column_name: string;
  f_schema: string;
  f_table: string;
  f_column: string;
}

export async function ingest(req: IngestRequest): Promise<IngestResponse> {
  const s = getSettings();

  const config = await loadProjectConfig(s.projectsDir, req.project_id);
  const context = await loadContextFile(s.projectsDir, req.project_id);

  // Allow env var to override the DSN from config.json (useful in Docker / prod)
  const envKey = `GET_IT_PROJECT_${req.project_id.toUpperCase().replace(/-/g, '_')}_DSN`;
  const targetDsn = process.env[envKey] ?? config.target_dsn;

  const schemaChunks = await introspectSchema(targetDsn, config.schemas);
  const glossaryChunks = glossaryChunksOf(context);
  const noteChunks = tableNoteChunksOf(context);
  const exampleChunks = exampleChunksOf(context);
  const freeChunks = freeNoteChunksOf(context);

  const allChunks: Chunk[] = [...schemaChunks, ...glossaryChunks, ...noteChunks, ...exampleChunks, ...freeChunks];
  if (allChunks.length === 0) {
    throw new RangeError('Nothing to ingest: target schema is empty and no context.md provided');
  }

  const embeddings = await embedTexts(allChunks.map((c) => c.content), 'document');
  await store.writeProject(s.accountId, req.project_id, targetDsn, allChunks, embeddings);

  return {
    project_id: req.project_id,
    tables_indexed: schemaChunks.length,
    glossary_terms_indexed: glossaryChunks.length,
    table_notes_indexed: noteChunks.length,
    examples_indexed: exampleChunks.length,
    free_notes_indexed: freeChunks.length,
  };
}

async function introspectSchema(dsn: string, schemas?: string[]): Promise<Chunk[]> {
  const client = new pg.Client({ connectionString: dsn });
  await client.connect();
  try {
    const useFilter = schemas && schemas.length > 0;
    const tables = await client.query<{ table_schema: string; table_name: string }>(
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_type = 'BASE TABLE'
         AND table_schema NOT IN ('pg_catalog', 'information_schema')
         ${useFilter ? 'AND table_schema = ANY($1)' : ''}
       ORDER BY table_schema, table_name`,
      useFilter ? [schemas] : [],
    );

    const chunks: Chunk[] = [];
    for (const t of tables.rows) {
      const cols = await client.query<ColumnRow>(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [t.table_schema, t.table_name],
      );
      const fks = await client.query<FkRow>(
        `SELECT kcu.column_name, ccu.table_schema AS f_schema,
                ccu.table_name AS f_table, ccu.column_name AS f_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_schema = $1 AND tc.table_name = $2`,
        [t.table_schema, t.table_name],
      );
      chunks.push({
        kind: 'schema',
        ref: `${t.table_schema}.${t.table_name}`,
        content: formatTable(t.table_schema, t.table_name, cols.rows, fks.rows),
        metadata: { schema: t.table_schema, table: t.table_name },
      });
    }
    return chunks;
  } finally {
    await client.end();
  }
}

function formatTable(schema: string, name: string, cols: ColumnRow[], fks: FkRow[]): string {
  const lines = [`TABLE ${schema}.${name}`];
  for (const c of cols) {
    const nullable = c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
    const def = c.column_default ? ` DEFAULT ${c.column_default}` : '';
    lines.push(`  ${c.column_name} ${c.data_type} ${nullable}${def}`);
  }
  for (const fk of fks) {
    lines.push(`  FK ${fk.column_name} -> ${fk.f_schema}.${fk.f_table}(${fk.f_column})`);
  }
  return lines.join('\n');
}

function glossaryChunksOf(ctx: BusinessContext): Chunk[] {
  return ctx.glossary.map((g) => ({
    kind: 'glossary',
    ref: g.term,
    content: `${g.term}: ${g.definition}`,
  }));
}

function tableNoteChunksOf(ctx: BusinessContext): Chunk[] {
  return ctx.table_notes.map((n) => ({
    kind: 'table_note',
    ref: n.table,
    content: `Note on ${n.table}: ${n.note}`,
  }));
}

function exampleChunksOf(ctx: BusinessContext): Chunk[] {
  return ctx.examples.map((e) => ({
    kind: 'example',
    ref: null,
    content: `Q: ${e.question}\nSQL: ${e.sql}`,
  }));
}

function freeNoteChunksOf(ctx: BusinessContext): Chunk[] {
  return ctx.free_notes.map((n) => ({
    kind: 'table_note',
    ref: n.section,
    content: `${n.section}:\n${n.content}`,
  }));
}
