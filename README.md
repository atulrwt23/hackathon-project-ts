# BusinessDNA

Teach AI how your business works. Point it at your codebase and database — it reads your code to understand business rules, scans your schema, and lets anyone ask plain-English questions that come back as accurate SQL with visualizations.

```
npx businessdna
```

Browser opens. Fill in your repo path and DB. Ask questions like:
- *"Who are our premium customers?"* — answers using the definition it found in your code
- *"Monthly revenue trend this year"* — renders a line chart
- *"Which products are underperforming?"* — uses your own business thresholds, not guesses

---

## How it works

```
Your codebase ──► Claude Haiku   ──► Business concepts   ──┐
                  (extracts rules)    (Premium Customer,      │
                                       MRR, Churn Rate...)    │
                                                              ▼
                                                        Voyage AI
                                                        (turns text
Your database ──► Schema reader  ──► Table definitions ──► into vectors)
                  (information_schema)                        │
                                                              ▼
                                                       pgvector DB
                                                       (stores everything)

User asks question
      │
      ▼
Voyage AI embeds question ──► vector search finds relevant schema + glossary
      │
      ▼
Claude Sonnet builds SQL grounded in YOUR business context
      │
      ▼
SQL validated (read-only) ──► runs on your DB ──► chart or table in browser
```

---

## Using it in your project

### Prerequisites

You need three things before running BusinessDNA:

**1. API keys**

- [Anthropic API key](https://console.anthropic.com/) — Claude scans your code and generates SQL
- [Voyage AI API key](https://www.voyageai.com/) — converts text to vectors (free tier works)

**2. A metadata PostgreSQL database with pgvector**

This is a side-car database BusinessDNA uses to store its vectors. It is completely separate from your application's database — BusinessDNA never writes to your app's DB.

Easiest way to spin one up:

```bash
docker run -d \
  --name businessdna-meta \
  -e POSTGRES_USER=biz \
  -e POSTGRES_PASSWORD=biz \
  -e POSTGRES_DB=biz \
  -p 55433:5432 \
  pgvector/pgvector:pg16
```

BusinessDNA will create its own tables (`ingests`, `chunks`) automatically on first run.

**3. Node.js >= 20**

```bash
node --version   # must be v20+
```

---

### Step 1 — Add a `.env` file to your project root

```bash
# Your project root
touch .env
```

Add these three variables:

```env
ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...
BUSINESSDNA_METADATA_DSN=postgresql://biz:biz@localhost:55433/biz
```

> Your `.env` never leaves your machine. BusinessDNA reads it from your project directory at startup.

---

### Step 2 — Run it

```bash
cd your-project
npx businessdna
```

The browser opens at `http://localhost:7331`. You'll see a setup form — fill it in once:

| Field | What to enter |
|---|---|
| Repository Path | Absolute path to the codebase to analyze (e.g. `/Users/you/myapp`) |
| Database Connection String | Your app's postgres DSN (read-only access is fine) |
| DB Schema(s) to Scan | Comma-separated schemas, e.g. `public` or `public, app` |

Click **Analyze Business**. The scan runs (2–5 minutes for a medium codebase). After it completes, you land on the dashboard.

> Next time you run `npx businessdna`, it skips setup and goes straight to the dashboard — your settings are saved in `businessdna.config.json` in your project root.

---

### Step 3 — Ask questions

Switch to the **Chat** tab and ask in plain English:

- *"Show top customers by revenue"*
- *"Which products are low on stock?"*
- *"How many orders were placed last month?"*
- *"Who are our churned customers?"*

Results render as KPI cards, bar charts, line charts, or tables depending on the shape of the data. Click **Show SQL** under any answer to see the query that ran.

---

### Optional: pin a version as a dev dependency

Instead of `npx` each time:

```bash
npm install --save-dev businessdna
```

Add to your `package.json`:

```json
"scripts": {
  "insight": "businessdna"
}
```

Then run:

```bash
npm run insight
```

---

### Config file

After the first scan, `businessdna.config.json` is created in your project root:

```json
{
  "repo_path": "/Users/you/myapp",
  "target_dsn": "postgresql://user@localhost:5432/mydb",
  "schema_filter": ["public"],
  "last_ingest_id": "ing_abc123xyz"
}
```

Add it to your `.gitignore` — it contains your DB connection string.

To trigger a fresh scan, click **← Rescan** in the dashboard header, or delete the file.

---

### Environment variable reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | — | Anthropic API key (also accepts `BUSINESSDNA_ANTHROPIC_KEY`) |
| `VOYAGE_API_KEY` | yes | — | Voyage AI key (also accepts `BUSINESSDNA_VOYAGE_KEY`) |
| `BUSINESSDNA_METADATA_DSN` | yes | — | DSN for the pgvector metadata database |
| `BUSINESSDNA_PORT` | no | `7331` | Port the dashboard runs on |
| `NL2SQL_LLM_MODEL` | no | `claude-sonnet-4-6` | Claude model for SQL generation |
| `NL2SQL_EMBED_MODEL` | no | `voyage-3` | Voyage embedding model |
| `NL2SQL_MAX_ROWS` | no | `1000` | Max rows returned per query |

> Legacy `NL2SQL_*` variable names are still accepted for backwards compatibility.

---

## Cloning and developing

### Clone the repo

```bash
git clone https://github.com/your-org/businessdna
cd businessdna
```

### Install dependencies

```bash
npm install
cd frontend && npm install && cd ..
```

### Set up environment

```bash
cp .env.example .env
# fill in ANTHROPIC_API_KEY, VOYAGE_API_KEY, NL2SQL_METADATA_DSN
```

Start the pgvector metadata database:

```bash
docker compose up postgres -d
# or use the docker run command from the Prerequisites section above
```

### Run in development mode (two terminals)

**Terminal 1 — backend** (hot reload on `src/**`):
```bash
npm run dev
# Fastify starts on http://localhost:8080
```

**Terminal 2 — frontend** (Vite dev server with HMR):
```bash
cd frontend
npm run dev
# React starts on http://localhost:3000
# proxies /api/* to localhost:8080
```

Open `http://localhost:3000`.

### Build for production / plugin use

```bash
npm run build
# compiles TypeScript → dist/
# builds React → frontend/dist/
```

Then run as a single self-contained process:

```bash
node bin/businessdna.js
# serves everything from http://localhost:7331
```

### Scripts reference

| Command | Description |
|---|---|
| `npm run dev` | Backend with hot reload (`tsx watch`) |
| `npm run build` | Compile backend + build frontend |
| `npm run build:backend` | TypeScript → `dist/` only |
| `npm run build:frontend` | Vite build → `frontend/dist/` only |
| `npm run plugin` | Run built plugin (`node bin/businessdna.js`) |
| `npm test` | Run Vitest suite |
| `npm run typecheck` | Type-check without emitting |

---

## Project layout

```
businessdna/
├── bin/
│   └── businessdna.js        CLI entry point — loads .env, starts server, opens browser
│
├── src/                      Backend (TypeScript, compiled to dist/)
│   ├── app.ts                Fastify routes: /api/scan, /api/query, /api/config, ...
│   ├── scan.ts               Codebase scanner: file discovery → Claude Haiku extraction → Sonnet consolidation
│   ├── ingest.ts             DB introspection + chunk assembly + embedding write
│   ├── retrieve.ts           Vector similarity search at query time
│   ├── generate.ts           Prompt assembly + Claude SQL generation
│   ├── validate.ts           SQL safety check (read-only, LIMIT cap)
│   ├── execute.ts            Runs validated SQL against target DB
│   ├── embeddings.ts         Voyage AI client (batched, rate-limit retry)
│   ├── store.ts              pgvector read/write (ingests + chunks tables)
│   ├── config-file.ts        businessdna.config.json read/write
│   ├── settings.ts           Env var loading
│   └── types.ts              Zod schemas for all requests/responses
│
├── frontend/                 React dashboard (Vite + Tailwind CSS v4)
│   └── src/
│       ├── App.tsx           Root — reads config on mount, auto-navigates
│       ├── api.ts            All fetch calls to the backend
│       ├── types.ts          TypeScript interfaces
│       └── pages/
│           ├── SetupPage.tsx   Form: repo path, DB DSN, schema filter
│           ├── ScanPage.tsx    Live SSE progress bar during scan
│           └── DashboardPage.tsx  Overview (glossary) + Chat (NL query)
│
├── docker-compose.yml        Spins up pgvector postgres for the metadata DB
└── .env.example              Template for required environment variables
```

---

## Two databases — important distinction

```
Your app's database          BusinessDNA's metadata database
(e.g. ecommerce_demo)        (e.g. businessdna_meta)
─────────────────────        ──────────────────────────────
customers                    ingests    → tracks scans
orders                       chunks     → stores vectors + text
products                                  (schema, glossary, notes)
...

BusinessDNA reads your DB.   BusinessDNA owns this DB.
Never writes to it.          Your app has no idea it exists.
```

---

## What gets stored where

After a scan, the metadata database contains **one row per chunk**:

| `kind` | Source | Example content |
|---|---|---|
| `schema` | Your DB's `information_schema` | `TABLE public.orders\n  status text NOT NULL...` |
| `glossary` | Your codebase (via Claude) | `Premium Customer: lifetime spend > $10,000...` |
| `table_note` | Claude bridging code + schema | `Note on orders: single source of truth for revenue...` |

Every row also has a 1024-dimension vector (Voyage AI embedding of the text). At query time, your question is embedded and the closest-matching rows are retrieved and passed to Claude to generate SQL.

The codebase files themselves are **not stored** — only the extracted concepts.
