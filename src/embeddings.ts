import { getSettings } from './settings.js';

export class EmbeddingProviderError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'EmbeddingProviderError';
  }
}

export async function embedTexts(
  texts: string[],
  inputType: 'document' | 'query' = 'document',
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const s = getSettings();

  const resp = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${s.voyageApiKey}`,
    },
    body: JSON.stringify({ input: texts, model: s.embedModel, input_type: inputType }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new EmbeddingProviderError(
      `Voyage embeddings failed (${resp.status}): ${body.slice(0, 300)}`,
      resp.status,
    );
  }

  const data = (await resp.json()) as { data: Array<{ embedding: number[] }> };
  return data.data.map((d) => d.embedding);
}

export async function embedOne(text: string, inputType: 'document' | 'query' = 'query'): Promise<number[]> {
  const [v] = await embedTexts([text], inputType);
  if (!v) throw new EmbeddingProviderError('Voyage returned no embedding for single text');
  return v;
}
