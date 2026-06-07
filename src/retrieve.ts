import { embedOne } from './embeddings.js';
import * as store from './store.js';
import { getSettings } from './settings.js';
import type { RetrievedContext } from './types.js';

export async function retrieve(ingestId: string, question: string): Promise<RetrievedContext> {
  const s = getSettings();
  const qvec = await embedOne(question, 'query');

  const [schema, glossary, tableNotes, examples] = await Promise.all([
    store.searchChunks(ingestId, qvec, 'schema', s.topKSchema),
    store.searchChunks(ingestId, qvec, 'glossary', s.topKGlossary),
    store.searchChunks(ingestId, qvec, 'table_note', s.topKGlossary),
    store.searchChunks(ingestId, qvec, 'example', s.topKExamples),
  ]);

  return { schema, glossary, table_notes: tableNotes, examples };
}
