export interface Settings {
  accountId: string;
  projectsDir: string;
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

function requireEnv(name: string, ...fallbacks: string[]): string {
  for (const n of [name, ...fallbacks]) {
    const v = process.env[n];
    if (v) return v;
  }
  const tried = [name, ...fallbacks].join(' or ');
  throw new Error(`Missing required env var: ${tried}`);
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
    accountId: requireEnv('GET_IT_ACCOUNT_ID'),
    // Directory where projects/{project_id}/config.json and context.md live.
    // Can be overridden to a mounted volume in Docker.
    projectsDir: process.env.GET_IT_PROJECTS_DIR ?? './projects',
    metadataDsn: requireEnv('NL2SQL_METADATA_DSN', 'METADATA_DSN'),
    anthropicApiKey: requireEnv('NL2SQL_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'),
    voyageApiKey: requireEnv('NL2SQL_VOYAGE_API_KEY', 'VOYAGE_API_KEY'),
    llmModel: process.env.NL2SQL_LLM_MODEL ?? 'claude-sonnet-4-6',
    embedModel: process.env.NL2SQL_EMBED_MODEL ?? 'voyage-3',
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
