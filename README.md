# get-it — Natural Language to SQL for PostgreSQL

Ask a question in plain English, get back generated SQL and live results.

get-it works by introspecting your database schema and embedding it alongside your business context (glossary terms, table notes, example queries) into a pgvector store. At query time it retrieves the most relevant chunks, prompts Claude to generate a safe SELECT statement, validates it (read-only, single statement, row-capped), and executes it against your target database.

---

## Architecture

```
                ┌─────────────────────────────────────────┐
                │           get-it-ts (Fastify)            │
                │                                          │
  POST /ingest  │  context-parser → embeddings → pgvector  │
  POST /query   │  vector search  → Claude → validate → pg │
                └─────────────────────────────────────────┘
                        │                        │
               Metadata DB                  Business DB
         pgvector/pgvector:pg16           postgres:16
              port 55433                  port 55434
          (chunks + embeddings)          (your data)
```

Two separate PostgreSQL instances:

- **Metadata DB** (port `55433`) — stores schema/glossary/example embeddings using `pgvector`. Managed by `get-it-ts/docker-compose.yml`.
- **Business DB** (port `55434`) — the database being queried. For the IPL demo this is loaded by `ipl-db/docker-compose.yml`.

---

## Prerequisites

- Node.js >= 20
- Docker + Docker Compose
- [Anthropic API key](https://console.anthropic.com/) — for Claude SQL generation
- [Voyage AI API key](https://www.voyageai.com/) — for embeddings

---

## Setup

### 1. Install dependencies

```bash
# NL2SQL service
cd get-it-ts
npm install

# IPL database seeder
cd ../ipl-db
npm install
cd ../get-it-ts
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your API keys:

```
GET_IT_ACCOUNT_ID=cricbuzz

GET_IT_PROJECTS_DIR=./projects

NL2SQL_METADATA_DSN=postgresql://nl2sql:nl2sql@localhost:55433/nl2sql

GET_IT_PROJECT_IPL_DSN=postgresql://ipl:ipl@localhost:55434/ipl

ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...
```

### 3. Start the databases

Start the metadata DB (get-it's vector store):

```bash
# from get-it-ts/
docker compose up -d postgres
```

Start the IPL business database:

```bash
# from ipl-db/
docker compose up -d ipl_db
```

Wait for both to be healthy:

```bash
docker compose ps   # from get-it-ts/
docker compose ps   # from ipl-db/
# both should show "(healthy)"
```

### 4. Apply the IPL schema

```bash
# from ipl-db/
npm run schema
```

This applies `schema.sql` — 10 tables with indexes and computed columns (`phase`, `is_dot_ball`, `is_boundary`, `is_four`, `is_six`).

### 5. Seed the IPL database

Load all 1 243 match JSON files from `../data/` (Cricsheet ball-by-ball data, 2008–2026):

```bash
# from ipl-db/
npm run seed
# prints progress every 100 matches, completes in ~2 minutes
```

### 6. Start the get-it server

```bash
# from get-it-ts/
npm run dev
```

The server starts on `http://localhost:8080`. You should see:

```
{"level":"info","msg":"nl2sql listening on http://0.0.0.0:8080"}
```

---

## Ingesting a Project

Ingest reads the project's `config.json` (target DSN, schemas to introspect) and `context.md` (glossary, table notes, examples), introspects the live schema, embeds everything, and stores it in the metadata DB.

Run once after setup, and re-run whenever the schema or context changes.

```bash
curl -s -X POST http://localhost:8080/ingest \
  -H "Content-Type: application/json" \
  -d '{"project_id": "ipl"}' | jq .
```

Expected response:

```json
{
  "project_id": "ipl",
  "tables_indexed": 10,
  "glossary_terms_indexed": 31,
  "table_notes_indexed": 25,
  "examples_indexed": 15
}
```

---

## Querying

```bash
curl -s -X POST http://localhost:8080/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Who are the top 10 run-scorers in IPL history?",
    "principal": {"user_id": "demo", "roles": []}
  }' | jq '{sql, rows, latency_ms}'
```

Response shape:

```json
{
  "sql": "SELECT batter_name, SUM(runs_batter) AS total_runs ...",
  "rows": [
    {"batter_name": "V Kohli", "total_runs": 8004},
    ...
  ],
  "row_count": 10,
  "truncated": false,
  "latency_ms": 2350
}
```

> **Voyage AI free tier is 3 RPM.** Wait ~20 seconds between queries or upgrade to a paid plan.

### More example queries

**Best bowling economy in death overs (min 300 balls)**
```bash
curl -s -X POST http://localhost:8080/query \
  -H "Content-Type: application/json" \
  -d '{"question":"Which bowler has the best economy rate in death overs? Minimum 300 legal balls.","principal":{"user_id":"demo","roles":[]}}' \
  | jq '{sql, rows}'
```

**Team wins — batting first vs chasing**
```bash
curl -s -X POST http://localhost:8080/query \
  -H "Content-Type: application/json" \
  -d '{"question":"What is each teams win rate when batting first versus chasing?","principal":{"user_id":"demo","roles":[]}}' \
  | jq '{sql, rows}'
```

**Mumbai Indians vs Chennai Super Kings head-to-head**
```bash
curl -s -X POST http://localhost:8080/query \
  -H "Content-Type: application/json" \
  -d '{"question":"Show the head-to-head record between Mumbai Indians and Chennai Super Kings.","principal":{"user_id":"demo","roles":[]}}' \
  | jq '{sql, rows}'
```

**Does winning the toss help?**
```bash
curl -s -X POST http://localhost:8080/query \
  -H "Content-Type: application/json" \
  -d '{"question":"Does winning the toss help? Show win rate for toss winners vs toss losers.","principal":{"user_id":"demo","roles":[]}}' \
  | jq '{sql, rows}'
```

**Dry run — validate SQL without executing**
```bash
curl -s -X POST http://localhost:8080/query \
  -H "Content-Type: application/json" \
  -d '{"question":"Top sixes hitters","principal":{"user_id":"demo","roles":[]},"dry_run":true}' \
  | jq '{sql, row_count}'
```

---

## API Reference

### `GET /healthz`

Liveness probe.

```json
{"status": "ok"}
```

---

### `POST /ingest`

Indexes a project's schema + context into the vector store. Must be called before any queries against that project.

**Request**
```json
{"project_id": "ipl"}
```

The `project_id` maps to a folder under `GET_IT_PROJECTS_DIR`:

```
projects/
  ipl/
    config.json    ← target DSN + schemas list
    context.md     ← glossary, table notes, examples
```

**Response**
```json
{
  "project_id": "ipl",
  "tables_indexed": 10,
  "glossary_terms_indexed": 31,
  "table_notes_indexed": 25,
  "examples_indexed": 15
}
```

---

### `POST /query`

Translates a natural-language question to SQL and executes it.

**Request**
```json
{
  "question": "Who scored the most runs in 2024?",
  "principal": {
    "user_id": "u_123",
    "roles": ["analyst"],
    "tenant_id": "t_42"
  },
  "max_rows": 500,
  "dry_run": false
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `question` | string | yes | — | Natural-language question |
| `principal.user_id` | string | yes | — | Identity of the caller |
| `principal.roles` | string[] | no | `[]` | Roles (passed to Claude for context) |
| `principal.tenant_id` | string | no | `null` | Tenant (set as `nl2sql.tenant_id` session var) |
| `max_rows` | integer | no | `1000` | Cap on rows returned (max 10 000) |
| `dry_run` | boolean | no | `false` | Run EXPLAIN only — no rows returned |

**Response**
```json
{
  "sql": "SELECT ...",
  "rows": [...],
  "row_count": 10,
  "truncated": false,
  "latency_ms": 2400
}
```

All queries run inside a `READ ONLY` transaction with a configurable statement timeout.

---

## Adding a New Project

Create a folder under `projects/`:

```
projects/
  my-project/
    config.json
    context.md      (optional)
```

**`config.json`**
```json
{
  "target_dsn": "postgresql://user:pass@host:5432/mydb",
  "schemas": ["public"]
}
```

The DSN can also be supplied via environment variable, which takes precedence over `config.json`. The pattern is:

```
GET_IT_PROJECT_{PROJECT_ID_UPPERCASE}_DSN=postgresql://...
```

For example, project `my-project` → `GET_IT_PROJECT_MY_PROJECT_DSN`.

**`context.md`** — three optional sections, one entry per line:

```markdown
## GLOSSARY
MRR: Monthly Recurring Revenue — sum of active subscriptions normalized to a monthly value.
Churn: Customers who cancelled in a given period.

## TABLE NOTES
orders: soft-deleted rows have deleted_at set; always filter WHERE deleted_at IS NULL.
orders: status values are 'pending', 'shipped', 'delivered', 'cancelled'.

## EXAMPLES
Q: How many orders shipped last week?
SQL: SELECT COUNT(*) FROM orders WHERE status = 'shipped' AND shipped_at >= NOW() - INTERVAL '7 days'
```

Then ingest:

```bash
curl -s -X POST http://localhost:8080/ingest \
  -H "Content-Type: application/json" \
  -d '{"project_id": "my-project"}' | jq .
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GET_IT_ACCOUNT_ID` | yes | — | Logical namespace for this deployment (e.g. `cricbuzz`) |
| `NL2SQL_METADATA_DSN` | yes | — | DSN for the pgvector metadata database |
| `ANTHROPIC_API_KEY` | yes | — | Anthropic API key for Claude SQL generation |
| `VOYAGE_API_KEY` | yes | — | Voyage AI API key for embeddings |
| `GET_IT_PROJECTS_DIR` | no | `./projects` | Directory containing project config folders |
| `GET_IT_PROJECT_<ID>_DSN` | no | — | Per-project DSN override (wins over `config.json`) |
| `NL2SQL_LLM_MODEL` | no | `claude-sonnet-4-6` | Claude model for SQL generation |
| `NL2SQL_EMBED_MODEL` | no | `voyage-3` | Voyage embedding model |
| `NL2SQL_EMBED_DIM` | no | `1024` | Embedding vector dimension |
| `NL2SQL_MAX_ROWS` | no | `1000` | Default row cap on query results |
| `NL2SQL_STATEMENT_TIMEOUT_MS` | no | `5000` | Per-query PostgreSQL statement timeout (ms) |
| `NL2SQL_TOP_K_SCHEMA` | no | `8` | Schema chunks retrieved per query |
| `NL2SQL_TOP_K_GLOSSARY` | no | `6` | Glossary chunks retrieved per query |
| `NL2SQL_TOP_K_EXAMPLES` | no | `4` | Example chunks retrieved per query |
| `PORT` | no | `8080` | HTTP listen port |

---

## Project Layout

```
hackathon/
├── data/                        1 243 Cricsheet IPL match JSON files (2008–2026)
│
├── ipl-db/
│   ├── docker-compose.yml       Postgres 16 on port 55434
│   ├── schema.sql               10-table IPL schema with indexes + computed columns
│   ├── seed.ts                  Loads all JSON files from ../data/ into the DB
│   └── package.json
│
└── get-it-ts/
    ├── docker-compose.yml       pgvector metadata DB on port 55433
    ├── .env.example             Environment variable template
    ├── projects/
    │   └── ipl/
    │       ├── config.json      Target DSN + schema list for the IPL project
    │       └── context.md       IPL glossary (31 terms), table notes, 15 example Q/SQL pairs
    ├── src/
    │   ├── server.ts            Fastify entry point (binds PORT)
    │   ├── app.ts               Route handlers: GET /healthz, POST /ingest, POST /query
    │   ├── ingest.ts            Schema introspection + context parsing + embedding
    │   ├── retrieve.ts          Vector similarity search for context retrieval
    │   ├── generate.ts          Claude prompt assembly + SQL extraction
    │   ├── validate.ts          SQL safety check (read-only, single SELECT, LIMIT cap)
    │   ├── execute.ts           Runs validated SQL in a READ ONLY transaction
    │   ├── embeddings.ts        Voyage AI embedding client
    │   ├── store.ts             pgvector metadata store (write + read chunks)
    │   ├── context-parser.ts    Parses context.md sections (GLOSSARY / TABLE NOTES / EXAMPLES)
    │   ├── settings.ts          Env-var loading with defaults
    │   └── types.ts             Zod schemas for all request/response types
    └── tests/                   Vitest unit tests
```

---

## Scripts

### get-it-ts

| Command | Description |
|---|---|
| `npm run dev` | Start server with hot reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled server |
| `npm test` | Run Vitest suite once |
| `npm run typecheck` | Type-check without emitting |

### ipl-db

| Command | Description |
|---|---|
| `npm run schema` | Apply `schema.sql` to the IPL database |
| `npm run seed` | Load all match JSON files from `../data/` |
# hackathon-project
