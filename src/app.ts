import Fastify, { type FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { ingest } from './ingest.js';
import { generateSql } from './generate.js';
import { retrieve } from './retrieve.js';
import { executeSql } from './execute.js';
import { getTargetDsn } from './store.js';
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
