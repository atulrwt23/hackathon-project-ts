import { embedOne } from './embeddings.js';
import * as store from './store.js';
import { getSettings } from './settings.js';
import type { RetrievedChunk, RetrievalResult } from './types.js';

export async function retrieve(question: string): Promise<RetrievalResult> {
  const s = getSettings();
  const qvec = await embedOne(question, 'query');

  const [schema, glossary, tableNotes, examples] = await Promise.all([
    store.searchChunks(s.accountId, qvec, 'schema', s.topKSchema),
    store.searchChunks(s.accountId, qvec, 'glossary', s.topKGlossary),
    store.searchChunks(s.accountId, qvec, 'table_note', s.topKGlossary),
    store.searchChunks(s.accountId, qvec, 'example', s.topKExamples),
  ]);

  // Determine which project to execute the generated SQL against.
  // Schema chunks are the most reliable signal — they come directly from table definitions.
  const project_id = dominantProject(schema) ?? dominantProject(glossary) ?? dominantProject(examples);

  if (!project_id) {
    throw new Error('No projects ingested yet. Run POST /ingest for at least one project first.');
  }

  return {
    context: { schema, glossary, table_notes: tableNotes, examples },
    project_id,
  };
}

// Returns the project_id that appears most often in the chunk list.
function dominantProject(chunks: RetrievedChunk[]): string | null {
  if (chunks.length === 0) return null;
  const counts = new Map<string, number>();
  for (const c of chunks) {
    counts.set(c.project_id, (counts.get(c.project_id) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
