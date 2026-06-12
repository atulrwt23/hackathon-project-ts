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

export const BusinessContext = z.object({
  glossary: z.array(GlossaryEntry).default([]),
  table_notes: z.array(TableNote).default([]),
  examples: z.array(Example).default([]),
});
export type BusinessContext = z.infer<typeof BusinessContext>;

export const IngestRequest = z.object({
  target_dsn: z.string(),
  business_context: BusinessContext.default({ glossary: [], table_notes: [], examples: [] }),
  // Optional list of DB schemas to introspect. null = all non-system schemas.
  schema_filter: z.array(z.string()).nullable().default(null),
});

export const ScanRequest = z.object({
  repo_path: z.string().min(1),
  target_dsn: z.string().min(1),
  // Optional: restrict schema introspection to these DB schemas (e.g. ["public"]).
  // Defaults to ["public"] to avoid indexing unrelated schemas in shared databases.
  schema_filter: z.array(z.string()).default(['public']),
});
export type ScanRequest = z.infer<typeof ScanRequest>;

export const ScanResponse = z.object({
  ingest_id: z.string(),
  files_scanned: z.number(),
  concepts_found: z.number(),
  tables_indexed: z.number(),
  glossary_terms: z.number(),
});
export type ScanResponse = z.infer<typeof ScanResponse>;
export type IngestRequest = z.infer<typeof IngestRequest>;

export const IngestResponse = z.object({
  ingest_id: z.string(),
  tables_indexed: z.number(),
  glossary_terms_indexed: z.number(),
  examples_indexed: z.number(),
});
export type IngestResponse = z.infer<typeof IngestResponse>;

export const Principal = z.object({
  user_id: z.string(),
  roles: z.array(z.string()).default([]),
  tenant_id: z.string().nullable().optional(),
  attributes: z.record(z.unknown()).default({}),
});
export type Principal = z.infer<typeof Principal>;

export const QueryRequest = z.object({
  ingest_id: z.string(),
  question: z.string(),
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
  distance?: number;
}

export interface RetrievedContext {
  schema: RetrievedChunk[];
  glossary: RetrievedChunk[];
  table_notes: RetrievedChunk[];
  examples: RetrievedChunk[];
}
