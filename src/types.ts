import { z } from 'zod';

export const GlossaryEntry = z.object({
  term: z.string(),
  definition: z.string(),
});
export type GlossaryEntry = z.infer<typeof GlossaryEntry>;

export const TableNote = z.object({
  table: z.string(),
  note: z.string(),
});
export type TableNote = z.infer<typeof TableNote>;

export const Example = z.object({
  question: z.string(),
  sql: z.string(),
});
export type Example = z.infer<typeof Example>;

export const FreeNote = z.object({
  section: z.string(),
  content: z.string(),
});
export type FreeNote = z.infer<typeof FreeNote>;

export const BusinessContext = z.object({
  glossary: z.array(GlossaryEntry).default([]),
  table_notes: z.array(TableNote).default([]),
  examples: z.array(Example).default([]),
  free_notes: z.array(FreeNote).default([]),
});
export type BusinessContext = z.infer<typeof BusinessContext>;

// Ingest: client only provides the project_id.
// DSN and business context are read from disk (projects/{project_id}/config.json + context.md).
export const IngestRequest = z.object({
  project_id: z.string().min(1),
});
export type IngestRequest = z.infer<typeof IngestRequest>;

export const IngestResponse = z.object({
  project_id: z.string(),
  tables_indexed: z.number(),
  glossary_terms_indexed: z.number(),
  table_notes_indexed: z.number(),
  examples_indexed: z.number(),
  free_notes_indexed: z.number(),
});
export type IngestResponse = z.infer<typeof IngestResponse>;

export const Principal = z.object({
  user_id: z.string(),
  roles: z.array(z.string()).default([]),
  tenant_id: z.string().nullable().optional(),
  attributes: z.record(z.unknown()).default({}),
});
export type Principal = z.infer<typeof Principal>;

// Query: client only provides a question and who is asking.
// No ingest_id, no project_id — the plugin resolves everything internally.
export const QueryRequest = z.object({
  question: z.string().min(1),
  principal: Principal,
  max_rows: z.number().int().min(1).max(10_000).nullable().optional(),
  dry_run: z.boolean().default(false),
  explain: z.boolean().default(false),
});
export type QueryRequest = z.infer<typeof QueryRequest>;

export const QueryResponse = z.object({
  sql: z.string(),
  rows: z.array(z.record(z.unknown())),
  row_count: z.number(),
  truncated: z.boolean(),
  explanation: z.string().nullable().optional(),
  latency_ms: z.number(),
});
export type QueryResponse = z.infer<typeof QueryResponse>;

export interface Chunk {
  kind: 'schema' | 'glossary' | 'example' | 'table_note';
  ref: string | null;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface RetrievedChunk {
  kind: string;
  ref: string | null;
  content: string;
  metadata: Record<string, unknown>;
  project_id: string;
  distance?: number;
}

export interface RetrievedContext {
  schema: RetrievedChunk[];
  glossary: RetrievedChunk[];
  table_notes: RetrievedChunk[];
  examples: RetrievedChunk[];
}

export interface RetrievalResult {
  context: RetrievedContext;
  project_id: string;
}
