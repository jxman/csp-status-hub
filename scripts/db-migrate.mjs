#!/usr/bin/env node
// Runs the .sql files in scripts/db/ against DATABASE_URL, in filename order.
// Each file should be idempotent (CREATE TABLE IF NOT EXISTS, etc.) so this is
// safe to re-run. Usage: node scripts/db-migrate.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@neondatabase/serverless';

const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'db');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run `vercel env pull .env.local` and source it first.');
  process.exit(1);
}

const client = new Client(process.env.DATABASE_URL);
await client.connect();

const files = readdirSync(dbDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  const filePath = path.join(dbDir, file);
  const statements = readFileSync(filePath, 'utf8');
  console.log(`Applying ${file}...`);
  await client.query(statements);
  console.log(`  done`);
}

await client.end();
console.log(`Applied ${files.length} migration file(s).`);
