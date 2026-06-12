#!/usr/bin/env node
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';

// Load .env from the user's project directory (where they run npx businessdna)
loadDotenv({ path: resolve(process.cwd(), '.env'), override: false });

const PORT = Number(process.env.BUSINESSDNA_PORT ?? 7331);

const { buildApp } = await import('../dist/app.js');
const app = buildApp();

try {
  await app.listen({ port: PORT, host: '127.0.0.1' });
  const url = `http://localhost:${PORT}`;
  console.log(`\n  ◆ BusinessDNA is running\n`);
  console.log(`  Local: ${url}\n`);

  const { default: open } = await import('open');
  await open(url);
} catch (err) {
  console.error('Failed to start BusinessDNA:', err);
  process.exit(1);
}
