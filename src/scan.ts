import fg from 'fast-glob';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pLimit from 'p-limit';
import Anthropic from '@anthropic-ai/sdk';
import { getSettings } from './settings.js';
import type { BusinessContext } from './types.js';

// ─── file discovery ──────────────────────────────────────────────────────────

const SOURCE_GLOBS = [
  '**/*.{ts,tsx,js,jsx}',
  '**/*.{py,java,go,rb,cs,php,kt,scala}',
];

const IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.git/**',
  '**/vendor/**',
  '**/generated/**',
  '**/__generated__/**',
  '**/*.test.{ts,tsx,js,jsx}',
  '**/*.spec.{ts,tsx,js,jsx}',
  '**/*.d.ts',
  '**/migrations/**',
  '**/fixtures/**',
  '**/mocks/**',
  '**/coverage/**',
  '**/storybook/**',
];

// files whose names suggest business logic — scanned first
const PRIORITY_KEYWORDS = [
  'service', 'controller', 'model', 'repository', 'repo',
  'domain', 'entity', 'usecase', 'use-case', 'business',
  'handler', 'manager', 'calculator', 'processor', 'provider',
  'workflow', 'policy', 'rule', 'pricing', 'billing',
];

function isPriority(absPath: string): boolean {
  const lower = absPath.toLowerCase();
  return PRIORITY_KEYWORDS.some(k => lower.includes(k));
}

// ─── chunking ────────────────────────────────────────────────────────────────

function chunkByLines(content: string, size = 80, overlap = 10): string[] {
  const lines = content.split('\n');
  if (lines.length <= size) return [content];
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += size - overlap) {
    const chunk = lines.slice(i, i + size).join('\n');
    if (chunk.trim().length > 0) chunks.push(chunk);
  }
  return chunks;
}

// ─── types ───────────────────────────────────────────────────────────────────

interface RawConcept {
  term: string;
  definition: string;
  related_tables: string[];
  confidence: 'high' | 'medium' | 'low';
  source_file: string;
}

export interface ScanProgress {
  phase: 'discovering' | 'extracting' | 'consolidating' | 'ingesting' | 'done';
  files_total: number;
  files_processed: number;
  concepts_found: number;
  current_file?: string;
}

export type OnProgress = (p: ScanProgress) => void;

// ─── json extraction (handles model prose around the JSON) ───────────────────

function parseJsonSafe(text: string): unknown {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return null;
}

// ─── extraction prompt ───────────────────────────────────────────────────────

const EXTRACT_SYSTEM = `You extract business concepts from application source code.

INCLUDE:
- Business entity names and their definitions (Customer, Order, Product, Subscription)
- Metric calculations (revenue, churn rate, conversion rate, LTV)
- Business rules and thresholds (e.g. premium customer = lifetime spend > 50000)
- Domain status meanings (e.g. order "completed" means payment has been received)
- Key business operations and what they represent in the real world

EXCLUDE:
- HTTP handlers, middleware, decorators, routing boilerplate
- Database ORM query builders and connection setup
- Import/export statements, configuration, env variable access
- Error handling plumbing, logging, validation utilities
- Test utilities, mocks, fixtures, factories
- Generic utilities (format, parse, serialize, hash)
- Framework lifecycle hooks

Respond ONLY with valid JSON, no prose:
{"concepts":[{"term":"...","definition":"...","related_tables":["..."],"confidence":"high|medium|low"}]}
If no business concepts found: {"concepts":[]}`;

async function extractFromChunk(
  chunk: string,
  relPath: string,
  client: Anthropic,
): Promise<RawConcept[]> {
  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: EXTRACT_SYSTEM,
      messages: [{ role: 'user', content: `File: ${relPath}\n\n${chunk}` }],
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    const parsed = parseJsonSafe(text) as { concepts?: RawConcept[] } | null;
    if (!parsed?.concepts) return [];

    return parsed.concepts.map(c => ({
      term: c.term,
      definition: c.definition,
      related_tables: Array.isArray(c.related_tables) ? c.related_tables : [],
      confidence: (['high', 'medium', 'low'] as const).includes(c.confidence) ? c.confidence : 'medium',
      source_file: relPath,
    }));
  } catch {
    return [];
  }
}

// ─── consolidation prompt ────────────────────────────────────────────────────

const CONSOLIDATE_SYSTEM = `You consolidate raw business concept extractions from a codebase scan into clean definitions.

Tasks:
1. Merge near-duplicates (e.g. "revenue" + "total revenue" → "Revenue")
2. Pick the most complete/accurate definition when multiple exist
3. Remove purely technical or framework-level entries (not real business concepts)
4. Remove "low" confidence entries unless they appear across 2+ source files
5. Write definitions in plain business language, not code language
6. For database tables referenced by concepts, write a brief business note explaining what the table represents

Output ONLY valid JSON:
{"glossary":[{"term":"...","definition":"..."}],"table_notes":[{"table":"...","note":"..."}]}`;

async function consolidate(
  raw: RawConcept[],
  client: Anthropic,
): Promise<BusinessContext> {
  if (raw.length === 0) return { glossary: [], table_notes: [], examples: [] };

  // group by normalised term name
  const grouped = new Map<string, RawConcept[]>();
  for (const c of raw) {
    const key = c.term.toLowerCase().trim();
    const arr = grouped.get(key) ?? [];
    arr.push(c);
    grouped.set(key, arr);
  }

  // build payload for Claude — max 200 concept groups to keep the prompt size sane
  const payload = [...grouped.entries()]
    .slice(0, 200)
    .map(([, defs]) => ({
      term: defs[0]!.term,
      definitions: [...new Set(defs.map(d => d.definition))],
      source_files: [...new Set(defs.map(d => d.source_file))],
      related_tables: [...new Set(defs.flatMap(d => d.related_tables))],
      confidence: defs.some(d => d.confidence === 'high')
        ? 'high'
        : defs.some(d => d.confidence === 'medium') ? 'medium' : 'low',
    }));

  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: CONSOLIDATE_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    const parsed = parseJsonSafe(text) as BusinessContext | null;
    if (parsed?.glossary) {
      return {
        glossary: parsed.glossary,
        table_notes: parsed.table_notes ?? [],
        examples: [],
      };
    }
  } catch { /* fall through to fallback */ }

  // fallback: return raw high/medium confidence entries without Claude polish
  const glossary = payload
    .filter(p => p.confidence !== 'low')
    .map(p => ({ term: p.term, definition: p.definitions[0]! }));
  return { glossary, table_notes: [], examples: [] };
}

// ─── public API ──────────────────────────────────────────────────────────────

export async function scanCodebase(
  repoPath: string,
  onProgress?: OnProgress,
): Promise<BusinessContext> {
  const s = getSettings();
  const client = new Anthropic({ apiKey: s.anthropicApiKey });
  const absRoot = resolve(repoPath);

  onProgress?.({ phase: 'discovering', files_total: 0, files_processed: 0, concepts_found: 0 });

  const allFiles = await fg(SOURCE_GLOBS, {
    cwd: absRoot,
    ignore: IGNORE_GLOBS,
    absolute: true,
  });

  // priority files first so the most useful concepts surface early in the stream
  const sorted = [
    ...allFiles.filter(isPriority),
    ...allFiles.filter(f => !isPriority(f)),
  ];

  const limit = pLimit(10);
  const allConcepts: RawConcept[] = [];
  let processed = 0;

  await Promise.all(sorted.map(absPath =>
    limit(async () => {
      const relPath = absPath.startsWith(absRoot + '/')
        ? absPath.slice(absRoot.length + 1)
        : absPath;

      onProgress?.({
        phase: 'extracting',
        files_total: sorted.length,
        files_processed: processed,
        concepts_found: allConcepts.length,
        current_file: relPath,
      });

      const content = await readFile(absPath, 'utf-8').catch(() => '');
      if (!content.trim()) { processed++; return; }

      const chunks = chunkByLines(content);
      const results = await Promise.all(
        chunks.map(chunk => extractFromChunk(chunk, relPath, client))
      );
      allConcepts.push(...results.flat());
      processed++;
    })
  ));

  onProgress?.({
    phase: 'consolidating',
    files_total: sorted.length,
    files_processed: processed,
    concepts_found: allConcepts.length,
  });

  return consolidate(allConcepts, client);
}
