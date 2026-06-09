import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { BusinessContext, FreeNote, GlossaryEntry, TableNote, Example } from './types.js';

const KNOWN_SECTIONS = new Set(['GLOSSARY', 'TABLE NOTES', 'EXAMPLES']);

export function parseContextMarkdown(content: string): BusinessContext {
  const glossary: GlossaryEntry[] = [];
  const table_notes: TableNote[] = [];
  const examples: Example[] = [];
  const free_notes: FreeNote[] = [];

  let section: string | null = null;
  let pendingQuestion: string | null = null;
  let freeLines: string[] = [];

  function flushFreeSection() {
    if (section && !KNOWN_SECTIONS.has(section) && freeLines.length > 0) {
      free_notes.push({ section, content: freeLines.join('\n') });
    }
    freeLines = [];
  }

  for (const raw of content.split('\n')) {
    const line = raw.trim();

    if (line.startsWith('## ')) {
      flushFreeSection();
      section = line.slice(3).trim().toUpperCase();
      pendingQuestion = null;
      continue;
    }

    if (!line || line.startsWith('#')) continue;

    if (section === 'GLOSSARY') {
      const colon = line.indexOf(':');
      if (colon > 0) {
        glossary.push({ term: line.slice(0, colon).trim(), definition: line.slice(colon + 1).trim() });
      }
    } else if (section === 'TABLE NOTES') {
      const colon = line.indexOf(':');
      if (colon > 0) {
        table_notes.push({ table: line.slice(0, colon).trim(), note: line.slice(colon + 1).trim() });
      }
    } else if (section === 'EXAMPLES') {
      if (line.startsWith('Q:')) {
        pendingQuestion = line.slice(2).trim();
      } else if (line.startsWith('SQL:') && pendingQuestion) {
        examples.push({ question: pendingQuestion, sql: line.slice(4).trim() });
        pendingQuestion = null;
      }
    } else if (section) {
      freeLines.push(raw);  // preserve original indentation for tables/code
    }
  }

  flushFreeSection();

  return { glossary, table_notes, examples, free_notes };
}

export async function loadContextFile(projectsDir: string, projectId: string): Promise<BusinessContext> {
  const filePath = path.join(projectsDir, projectId, 'context.md');
  try {
    const content = await readFile(filePath, 'utf-8');
    return parseContextMarkdown(content);
  } catch {
    // context.md is optional — a project may rely purely on schema introspection
    return { glossary: [], table_notes: [], examples: [], free_notes: [] };
  }
}

export interface ProjectConfig {
  target_dsn: string;
  schemas?: string[];
}

export async function loadProjectConfig(projectsDir: string, projectId: string): Promise<ProjectConfig> {
  const filePath = path.join(projectsDir, projectId, 'config.json');
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw) as ProjectConfig;
}
