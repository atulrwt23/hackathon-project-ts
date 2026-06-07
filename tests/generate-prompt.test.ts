import { describe, test, expect } from 'vitest';
import { formatContext, formatPrincipal, extractSql } from '../src/generate.js';
import type { Principal, RetrievedContext } from '../src/types.js';

function ctx(partial: Partial<RetrievedContext>): RetrievedContext {
  return {
    schema: partial.schema ?? [],
    glossary: partial.glossary ?? [],
    table_notes: partial.table_notes ?? [],
    examples: partial.examples ?? [],
  };
}

function principal(p: Partial<Principal> & { user_id: string }): Principal {
  return {
    user_id: p.user_id,
    roles: p.roles ?? [],
    tenant_id: p.tenant_id ?? null,
    attributes: p.attributes ?? {},
  };
}

describe('formatContext', () => {
  test('orders sections SCHEMA, TABLE NOTES, GLOSSARY, EXAMPLES', () => {
    const out = formatContext(
      ctx({
        schema: [{ kind: 'schema', ref: null, content: 'TABLE public.users\n  id int', metadata: {} }],
        glossary: [{ kind: 'glossary', ref: null, content: 'MRR: monthly recurring revenue', metadata: {} }],
        table_notes: [{ kind: 'table_note', ref: null, content: 'Note on users: flg=A is active', metadata: {} }],
        examples: [{ kind: 'example', ref: null, content: 'Q: foo\nSQL: SELECT 1', metadata: {} }],
      }),
    );
    expect(out.indexOf('SCHEMA:')).toBeLessThan(out.indexOf('TABLE NOTES:'));
    expect(out.indexOf('TABLE NOTES:')).toBeLessThan(out.indexOf('GLOSSARY:'));
    expect(out.indexOf('GLOSSARY:')).toBeLessThan(out.indexOf('EXAMPLES:'));
  });

  test('skips empty sections', () => {
    const out = formatContext(
      ctx({ schema: [{ kind: 'schema', ref: null, content: 'TABLE x', metadata: {} }] }),
    );
    expect(out).toContain('SCHEMA:');
    expect(out).not.toContain('GLOSSARY:');
    expect(out).not.toContain('EXAMPLES:');
  });
});

describe('formatPrincipal', () => {
  test('includes required fields', () => {
    const out = formatPrincipal(principal({ user_id: 'u_1', roles: ['analyst', 'admin'], tenant_id: 't_9' }));
    expect(out).toContain('user_id=u_1');
    expect(out).toContain('analyst,admin');
    expect(out).toContain('tenant_id=t_9');
  });

  test('handles missing optional fields', () => {
    const out = formatPrincipal(principal({ user_id: 'u_1' }));
    expect(out).toContain('roles=-');
    expect(out).toContain('tenant_id=-');
  });
});

describe('extractSql', () => {
  test('from fenced sql block', () => {
    const text = 'Here is the query:\n```sql\nSELECT 1\n```\nDone.';
    expect(extractSql(text)).toBe('SELECT 1');
  });

  test('from bare fence', () => {
    const text = '```\nSELECT 2\n```';
    expect(extractSql(text)).toBe('SELECT 2');
  });

  test('no fence returns stripped', () => {
    expect(extractSql('  SELECT 3  ')).toBe('SELECT 3');
  });
});
