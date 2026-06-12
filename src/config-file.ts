import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

export interface ProjectConfig {
  repo_path?: string;
  target_dsn?: string;
  schema_filter?: string[];
  last_ingest_id?: string;
}

const CONFIG_FILE = 'businessdna.config.json';

export async function readProjectConfig(cwd = process.cwd()): Promise<ProjectConfig> {
  try {
    const raw = await readFile(join(cwd, CONFIG_FILE), 'utf-8');
    return JSON.parse(raw) as ProjectConfig;
  } catch {
    return {};
  }
}

export async function writeProjectConfig(config: ProjectConfig, cwd = process.cwd()): Promise<void> {
  await writeFile(join(cwd, CONFIG_FILE), JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
