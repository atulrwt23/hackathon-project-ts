import Fastify, { type FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { ingest } from './ingest.js';
import { generateSql } from './generate.js';
import { retrieve } from './retrieve.js';
import { executeSql } from './execute.js';
import { getProjectDsn } from './store.js';
import { validateAndCap, SQLValidationError } from './validate.js';
import { EmbeddingProviderError } from './embeddings.js';
import { getSettings } from './settings.js';
import { IngestRequest, QueryRequest, type QueryResponse } from './types.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: { level: 'info' } });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.post('/ingest', async (req, reply) => {
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
      // Config or file-system errors (missing config.json, bad DSN, etc.)
      if (e instanceof Error && (e.message.includes('ENOENT') || e.message.includes('JSON'))) {
        return reply.code(400).send({ detail: `Project config error: ${e.message}` });
      }
      throw e;
    }
  });

  app.post('/query', async (req, reply) => {
    const parsed = QueryRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ detail: parsed.error.issues });
    }
    const body = parsed.data;
    const s = getSettings();
    const started = performance.now();

    let project_id: string;
    let rawSql: string;
    try {
      const retrieval = await retrieve(body.question);
      project_id = retrieval.project_id;
      rawSql = await generateSql(body.question, retrieval.context, body.principal);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('No projects ingested')) {
        return reply.code(503).send({ detail: e.message });
      }
      if (e instanceof EmbeddingProviderError) {
        return reply.code(502).send({ detail: e.message });
      }
      if (e instanceof Anthropic.APIError) {
        req.log.warn({ status: e.status }, 'anthropic api error');
        return reply.code(502).send({ detail: `anthropic: ${e.message}` });
      }
      throw e;
    }

    const targetDsn = await getProjectDsn(s.accountId, project_id);
    if (!targetDsn) {
      return reply.code(500).send({ detail: `No DSN found for resolved project: ${project_id}` });
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
        account_id: s.accountId,
        project_id,
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
