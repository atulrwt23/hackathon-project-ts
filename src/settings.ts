export interface Settings {
  metadataDsn: string;
  anthropicApiKey: string;
  voyageApiKey: string;
  llmModel: string;
  embedModel: string;
  embedDim: number;
  maxRows: number;
  statementTimeoutMs: number;
  topKSchema: number;
  topKGlossary: number;
  topKExamples: number;
}

let cached: Settings | null = null;

function pickEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const v = process.env[name];
    if (v) return v;
  }
}

function requireEnvAny(...names: string[]): string {
  const v = pickEnv(...names);
  if (!v) throw new Error(`Missing required env var — set one of: ${names.join(', ')}`);
  return v;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} is not an integer: ${v}`);
  return n;
}

export function getSettings(): Settings {
  if (cached) return cached;
  cached = {
    metadataDsn: requireEnvAny('BUSINESSDNA_METADATA_DSN', 'NL2SQL_METADATA_DSN'),
    anthropicApiKey: requireEnvAny('ANTHROPIC_API_KEY', 'BUSINESSDNA_ANTHROPIC_KEY', 'NL2SQL_ANTHROPIC_API_KEY'),
    voyageApiKey: requireEnvAny('VOYAGE_API_KEY', 'BUSINESSDNA_VOYAGE_KEY', 'NL2SQL_VOYAGE_API_KEY'),
    llmModel: pickEnv('NL2SQL_LLM_MODEL') ?? 'claude-sonnet-4-6',
    embedModel: pickEnv('NL2SQL_EMBED_MODEL') ?? 'voyage-3',
    embedDim: envInt('NL2SQL_EMBED_DIM', 1024),
    maxRows: envInt('NL2SQL_MAX_ROWS', 1000),
    statementTimeoutMs: envInt('NL2SQL_STATEMENT_TIMEOUT_MS', 5000),
    topKSchema: envInt('NL2SQL_TOP_K_SCHEMA', 8),
    topKGlossary: envInt('NL2SQL_TOP_K_GLOSSARY', 6),
    topKExamples: envInt('NL2SQL_TOP_K_EXAMPLES', 4),
  };
  return cached;
}

export function resetSettingsForTests(): void {
  cached = null;
}
