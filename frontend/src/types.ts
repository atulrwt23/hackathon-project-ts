export interface ScanProgress {
  phase: 'discovering' | 'extracting' | 'consolidating' | 'ingesting' | 'done';
  files_total: number;
  files_processed: number;
  concepts_found: number;
  current_file?: string;
}

export interface ScanResult {
  ingest_id: string;
  files_scanned: number;
  concepts_found: number;
  tables_indexed: number;
  glossary_terms: number;
}

export interface GlossaryEntry {
  term: string;
  definition: string;
}

export interface QueryResponse {
  sql: string;
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
  latency_ms: number;
}

export interface SetupFormData {
  repo_path: string;
  target_dsn: string;
  schema_filter: string; // comma-separated, e.g. "public" or "public,app"
}

export interface ProjectConfig {
  repo_path?: string;
  target_dsn?: string;
  schema_filter?: string[];
  last_ingest_id?: string;
}
