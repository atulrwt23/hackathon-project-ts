import Fastify, { type FastifyInstance } from 'fastify';
import staticPlugin from '@fastify/static';
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { ingest } from './ingest.js';
import { generateSql } from './generate.js';
import { retrieve } from './retrieve.js';
import { executeSql } from './execute.js';
import { getTargetDsn, listChunksByKind } from './store.js';
import { validateAndCap, SQLValidationError } from './validate.js';
import { EmbeddingProviderError } from './embeddings.js';
import { getSettings } from './settings.js';
import { readProjectConfig, writeProjectConfig, type ProjectConfig } from './config-file.js';
import { IngestRequest, QueryRequest, ScanRequest, type QueryResponse } from './types.js';
import { scanCodebase, type ScanProgress } from './scan.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FRONTEND_DIST = join(__dirname, '..', 'frontend', 'dist');

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: { level: 'info' } });

  // Serve built React frontend in plugin/production mode
  if (existsSync(FRONTEND_DIST)) {
    app.register(staticPlugin, {
      root: FRONTEND_DIST,
      prefix: '/',
    });

    // SPA fallback: unknown non-API paths → index.html (React Router handles them)
    app.setNotFoundHandler((req, reply) => {
      if (!req.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ detail: 'not found' });
    });
  }

  app.get('/healthz', async () => ({ status: 'ok' }));

  // ── Config endpoints ────────────────────────────────────────────────────────

  app.get('/api/config', async () => {
    return readProjectConfig();
  });

  app.post('/api/config', async (req) => {
    const current = await readProjectConfig();
    const patch = req.body as Record<string, unknown>;
    const updated: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) {
        delete updated[k];
      } else {
        updated[k] = v;
      }
    }
    await writeProjectConfig(updated as ProjectConfig);
    return updated;
  });

  // ── POST /api/scan — streams SSE progress then final result ─────────────────

  app.post('/api/scan', (req, reply) => {
    const parsed = ScanRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ detail: parsed.error.issues });
    }
    const { repo_path, target_dsn, schema_filter } = parsed.data;

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const send = (event: string, data: unknown) => {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let lastProgress: ScanProgress | undefined;

    (async () => {
      const businessContext = await scanCodebase(repo_path, (p) => {
        lastProgress = p;
        send('progress', p);
      });

      const ingestProgress = {
        phase: 'ingesting' as const,
        files_total: lastProgress?.files_total ?? 0,
        files_processed: lastProgress?.files_processed ?? 0,
        concepts_found: businessContext.glossary.length,
      };
      send('progress', ingestProgress);

      const heartbeat = setInterval(() => send('progress', ingestProgress), 5_000);
      let result;
      try {
        result = await ingest({ target_dsn, business_context: businessContext, schema_filter });
      } finally {
        clearInterval(heartbeat);
      }

      send('result', {
        ingest_id: result.ingest_id,
        files_scanned: lastProgress?.files_total ?? 0,
        concepts_found: businessContext.glossary.length,
        tables_indexed: result.tables_indexed,
        glossary_terms: result.glossary_terms_indexed,
      });
    })().catch((e: unknown) => {
      req.log.error(e, 'scan failed');
      send('error', { message: e instanceof Error ? e.message : String(e) });
    }).finally(() => {
      raw.end();
    });
  });

  // ── GET /api/glossary/:ingestId ─────────────────────────────────────────────

  app.get('/api/glossary/:ingestId', async (req, reply) => {
    const { ingestId } = req.params as { ingestId: string };
    const targetDsn = await getTargetDsn(ingestId);
    if (targetDsn === null) {
      return reply.code(404).send({ detail: `unknown ingest_id: ${ingestId}` });
    }
    const chunks = await listChunksByKind(ingestId, 'glossary');
    return chunks.map(c => ({
      term: c.ref ?? c.content,
      definition: c.ref && c.content.startsWith(c.ref + ': ')
        ? c.content.slice(c.ref.length + 2)
        : c.content,
    }));
  });

  // ── POST /api/ingest ────────────────────────────────────────────────────────

  app.post('/api/ingest', async (req, reply) => {
    const parsed = IngestRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ detail: parsed.error.issues });
    }
    try {
      return await ingest(parsed.data);
    } catch (e) {
      if (e instanceof RangeError) return reply.code(400).send({ detail: e.message });
      if (e instanceof EmbeddingProviderError) {
        req.log.warn({ status: e.status }, 'embedding provider error');
        return reply.code(502).send({ detail: e.message });
      }
      throw e;
    }
  });

  // ── POST /api/query ─────────────────────────────────────────────────────────

  app.post('/api/query', async (req, reply) => {
    const parsed = QueryRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ detail: parsed.error.issues });
    }
    const body = parsed.data;
    const s = getSettings();
    const started = performance.now();

    const targetDsn = await getTargetDsn(body.ingest_id);
    if (targetDsn === null) {
      return reply.code(404).send({ detail: `unknown ingest_id: ${body.ingest_id}` });
    }

    let rawSql: string;
    try {
      const ctx = await retrieve(body.ingest_id, body.question);
      rawSql = await generateSql(body.question, ctx, body.principal);
    } catch (e) {
      if (e instanceof EmbeddingProviderError) {
        return reply.code(502).send({ detail: e.message });
      }
      if (e instanceof Anthropic.APIError) {
        req.log.warn({ status: e.status }, 'anthropic api error');
        return reply.code(502).send({ detail: `anthropic: ${e.message}` });
      }
      throw e;
    }

    const cap = body.max_rows ?? s.maxRows;
    let sql: string;
    try {
      sql = validateAndCap(rawSql, cap);
    } catch (e) {
      if (e instanceof SQLValidationError) {
        req.log.warn({ reason: e.message, sql: rawSql }, 'sql_rejected');
        return reply.code(422).send({ detail: `generated SQL rejected: ${e.message}` });
      }
      throw e;
    }

    const rows = await executeSql(targetDsn, sql, body.principal, { dryRun: body.dry_run });
    const elapsedMs = Math.round(performance.now() - started);

    req.log.info(
      {
        ingest_id: body.ingest_id,
        user_id: body.principal.user_id,
        tenant_id: body.principal.tenant_id,
        row_count: rows.length,
        latency_ms: elapsedMs,
      },
      'query_served',
    );

    const out: QueryResponse = {
      sql,
      rows,
      row_count: rows.length,
      truncated: rows.length >= cap,
      latency_ms: elapsedMs,
    };
    return out;
  });

  return app;
}
