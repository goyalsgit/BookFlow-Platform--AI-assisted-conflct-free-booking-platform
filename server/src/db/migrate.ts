import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import pg from 'pg';
import {config} from '../config.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
// Connect directly to an already provisioned database: no superuser/CREATE DATABASE required.
// Use a direct/session connection URL, never a transaction-pooling URL for this session lock.
const client = new pg.Client({connectionString: process.env.MIGRATION_DATABASE_URL || config.databaseUrl});
try {
  await client.connect();
  await client.query("SET lock_timeout = '60s'");
  await client.query('SELECT pg_advisory_lock(73021, 1)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())');
  const migrations = [
    {name: '000_baseline', file: path.join(directory, 'schema.sql')},
    ...readdirSync(path.join(directory, 'migrations')).filter(name => name.endsWith('.sql')).sort()
      .map(name => ({name, file: path.join(directory, 'migrations', name)})),
  ];
  for (const migration of migrations) {
    if ((await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [migration.name])).rowCount) continue;
    await client.query('BEGIN');
    try {
      await client.query(readFileSync(migration.file, 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [migration.name]);
      await client.query('COMMIT');
      console.log(`Applied ${migration.name}`);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
  console.log('Database migrations are up to date.');
} catch (error: any) {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
} finally { await client.end(); }
