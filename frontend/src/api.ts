import type { ScanProgress, ScanResult, GlossaryEntry, QueryResponse, ProjectConfig } from './types';

type SseEvent =
  | { event: 'progress'; data: ScanProgress }
  | { event: 'result';   data: ScanResult }
  | { event: 'error';    data: { message: string } };

export async function* streamScan(body: {
  repo_path: string;
  target_dsn: string;
  schema_filter: string;
}): AsyncGenerator<SseEvent> {
  const schemas = body.schema_filter
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const resp = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo_path: body.repo_path,
      target_dsn: body.target_dsn,
      schema_filter: schemas.length > 0 ? schemas : ['public'],
    }),
  });

  if (!resp.ok || !resp.body) {
    yield { event: 'error', data: { message: `Server error: ${resp.status}` } };
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      if (!part.trim()) continue;
      let event = 'message';
      let data = '';
      for (const line of part.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        if (line.startsWith('data: '))  data  = line.slice(6).trim();
      }
      if (!data) continue;
      try {
        const parsed = JSON.parse(data);
        if (event === 'progress' || event === 'result' || event === 'error') {
          yield { event, data: parsed } as SseEvent;
        }
      } catch { /* skip unparseable chunks */ }
    }
  }
}

export async function fetchGlossary(ingestId: string): Promise<GlossaryEntry[]> {
  const resp = await fetch(`/api/glossary/${ingestId}`);
  if (!resp.ok) return [];
  return resp.json();
}

export async function sendQuery(params: {
  ingest_id: string;
  question: string;
}): Promise<QueryResponse> {
  const resp = await fetch('/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ingest_id: params.ingest_id,
      question: params.question,
      principal: { user_id: 'dashboard_user', roles: ['analyst'] },
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
    throw new Error(String(err.detail ?? `HTTP ${resp.status}`));
  }
  return resp.json();
}

export async function fetchConfig(): Promise<ProjectConfig> {
  try {
    const resp = await fetch('/api/config');
    if (!resp.ok) return {};
    return resp.json();
  } catch {
    return {};
  }
}

// Pass null for a field to remove it from config
export async function saveConfig(
  patch: Partial<{ [K in keyof ProjectConfig]: ProjectConfig[K] | null }>
): Promise<void> {
  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}
