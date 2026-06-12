import { getSettings } from './settings.js';

export class EmbeddingProviderError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'EmbeddingProviderError';
  }
}

// Voyage free tier: 3 RPM, 10K TPM.
// We batch into groups of 50 (≈7 500 tokens each) and retry 429s with backoff.
const BATCH_SIZE   = 50;
const MAX_RETRIES  = 6;
const RETRY_BASE_MS = 22_000; // 22s — slightly over the 20s/req minimum for 3 RPM

export async function embedTexts(
  texts: string[],
  inputType: 'document' | 'query' = 'document',
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const embeddings = await embedBatchWithRetry(batch, inputType);
    results.push(...embeddings);
  }
  return results;
}

async function embedBatchWithRetry(
  texts: string[],
  inputType: 'document' | 'query',
): Promise<number[][]> {
  const s = getSettings();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const resp = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${s.voyageApiKey}`,
      },
      body: JSON.stringify({ input: texts, model: s.embedModel, input_type: inputType }),
    });

    if (resp.ok) {
      const data = (await resp.json()) as { data: Array<{ embedding: number[] }> };
      return data.data.map(d => d.embedding);
    }

    const body = await resp.text().catch(() => '');

    if (resp.status === 429 && attempt < MAX_RETRIES) {
      // Respect Retry-After header if present, otherwise use exponential backoff
      const retryAfter = resp.headers.get('Retry-After');
      const delay = retryAfter
        ? Number(retryAfter) * 1000
        : RETRY_BASE_MS * Math.pow(1.5, attempt); // 22s → 33s → 49s → 74s …
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    throw new EmbeddingProviderError(
      `Voyage embeddings failed (${resp.status}): ${body.slice(0, 300)}`,
      resp.status,
    );
  }

  throw new EmbeddingProviderError('Voyage embeddings: max retries exceeded');
}

export async function embedOne(
  text: string,
  inputType: 'document' | 'query' = 'query',
): Promise<number[]> {
  const [v] = await embedTexts([text], inputType);
  if (!v) throw new EmbeddingProviderError('Voyage returned no embedding for single text');
  return v;
}
