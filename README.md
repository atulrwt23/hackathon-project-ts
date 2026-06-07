# nl2sql

A natural-language-to-SQL sidecar for PostgreSQL. Send a question and a target database, get back validated, row-capped, read-only SQL plus its results.

It works by ingesting your database schema and business context (glossary, table notes, example queries) into a metadata store backed by `pgvector`, then retrieving the most relevant context at query time and asking Claude to generate SQL grounded on it. Generated SQL is parsed and validated (read-only, single statement, row-capped) before it runs.

## Requirements

- Node.js **>= 20**
- PostgreSQL **16** with the [`pgvector`](https://github.com/pgvector/pgvector) extension (used both as the metadata store and a valid target database)
- An [Anthropic API key](https://console.anthropic.com/) — for SQL generation (default model: `claude-sonnet-4-6`)
- A [Voyage AI API key](https://www.voyageai.com/) — for embeddings (default model: `voyage-3`)
- Docker + Docker Compose (optional, for the easiest local setup)

## Setup

```bash
git clone <this-repo>
cd get-it-ts
npm install
cp .env.example .env
# edit .env and fill in ANTHROPIC_API_KEY and VOYAGE_API_KEY
```

## Running

### Option 1 — Docker Compose (recommended)

Brings up Postgres (with `pgvector`) and the nl2sql service together. `.env` provides the API keys.

```bash
docker compose up --build
```

- nl2sql: `http://localhost:8081`
- Postgres: `localhost:55433` (user `nl2sql`, password `nl2sql`, db `nl2sql`)

### Option 2 — Local dev

Run Postgres yourself (e.g. `docker compose up postgres`), then:

```bash
export NL2SQL_METADATA_DSN="postgresql://nl2sql:nl2sql@localhost:55433/nl2sql"
export NL2SQL_ANTHROPIC_API_KEY="sk-ant-..."
export NL2SQL_VOYAGE_API_KEY="pa-..."

npm run dev      # tsx watch, hot reload on src/**
# or
npm run build && npm start
```

Service listens on `PORT` (default `8080`).

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NL2SQL_METADATA_DSN` | yes | — | Postgres DSN for the metadata/vector store |
| `NL2SQL_ANTHROPIC_API_KEY` | yes | — | Anthropic API key |
| `NL2SQL_VOYAGE_API_KEY` | yes | — | Voyage AI API key |
| `NL2SQL_LLM_MODEL` | no | `claude-sonnet-4-6` | Claude model used to generate SQL |
| `NL2SQL_EMBED_MODEL` | no | `voyage-3` | Voyage embedding model |
| `NL2SQL_EMBED_DIM` | no | `1024` | Embedding dimension |
| `NL2SQL_MAX_ROWS` | no | `1000` | Default row cap on results |
| `NL2SQL_STATEMENT_TIMEOUT_MS` | no | `5000` | Per-query statement timeout |
| `NL2SQL_TOP_K_SCHEMA` | no | `8` | Schema chunks retrieved per query |
| `NL2SQL_TOP_K_GLOSSARY` | no | `6` | Glossary entries retrieved per query |
| `NL2SQL_TOP_K_EXAMPLES` | no | `4` | Few-shot examples retrieved per query |
| `PORT` | no | `8080` | HTTP listen port |

## API

### `GET /healthz`

Liveness probe — returns `{ "status": "ok" }`.

### `POST /ingest`

Indexes a target database's schema and business context, returns an `ingest_id` to use for subsequent queries.

```json
{
  "target_dsn": "postgresql://user:pass@host:5432/db",
  "business_context": {
    "glossary":    [{ "term": "MRR", "definition": "Monthly recurring revenue" }],
    "table_notes": [{ "table": "orders", "note": "Soft-deleted rows have deleted_at set." }],
    "examples":    [{ "question": "Top 5 customers by revenue", "sql": "SELECT ..." }]
  }
}
```

### `POST /query`

```json
{
  "ingest_id": "...",
  "question": "How many orders did we ship last week?",
  "principal": { "user_id": "u_123", "roles": ["analyst"], "tenant_id": "t_42" },
  "max_rows": 500,
  "dry_run": false
}
```

Returns the generated `sql`, the `rows`, `row_count`, `truncated`, and `latency_ms`. `dry_run: true` returns the SQL without executing it.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run the server with hot reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | Type-check without emitting |

## Project layout

```
src/
  server.ts       entry point — binds Fastify to PORT
  app.ts          routes: /healthz, /ingest, /query
  ingest.ts       schema introspection + business-context indexing
  retrieve.ts     vector retrieval for schema/glossary/examples
  generate.ts     prompt assembly + Claude call
  validate.ts     SQL parsing, read-only check, LIMIT capping
  execute.ts      runs validated SQL against target DSN
  embeddings.ts   Voyage embedding client
  store.ts        metadata-store access (pgvector)
  settings.ts     env-var loading
  types.ts        zod request/response schemas
tests/            Vitest unit tests
```
