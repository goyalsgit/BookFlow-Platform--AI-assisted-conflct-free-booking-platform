import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, link, mkdir, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: 'server/.env', quiet: true });

const [command, argument] = process.argv.slice(2);
const usage =
  'Usage: npm run db:backup -- [archive.dump] | RESTORE_DATABASE_URL=... npm run db:restore -- archive.dump';
if (!['backup', 'restore'].includes(command) || (command === 'restore' && !argument)) {
  console.error(usage);
  process.exit(2);
}

const connection =
  command === 'restore' ? process.env.RESTORE_DATABASE_URL : process.env.DATABASE_URL;
if (!connection)
  throw new Error(`${command === 'restore' ? 'RESTORE_DATABASE_URL' : 'DATABASE_URL'} is required`);
const url = new URL(connection);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.pathname.slice(1))
  throw new Error('Use a PostgreSQL URL with a database name');

const database = decodeURIComponent(url.pathname.slice(1));
const pgEnvironment = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || '5432',
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: database,
};
for (const [parameter, variable] of [
  ['sslmode', 'PGSSLMODE'],
  ['sslrootcert', 'PGSSLROOTCERT'],
  ['sslcert', 'PGSSLCERT'],
  ['sslkey', 'PGSSLKEY'],
]) {
  if (url.searchParams.has(parameter)) pgEnvironment[variable] = url.searchParams.get(parameter);
}

function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env: pgEnvironment, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${binary} exited with status ${code}`)),
    );
  });
}

const dockerAvailableForUrl =
  ['localhost', '127.0.0.1'].includes(url.hostname) && pgEnvironment.PGPORT === '54329';
// Compose derives container names from the project directory; discover the actual
// database container instead of assuming a name that compose.yaml does not set.
const executeFile = promisify(execFile);
async function databaseContainer() {
  if (process.env.BOOKFLOW_DB_CONTAINER) return process.env.BOOKFLOW_DB_CONTAINER;
  const { stdout } = await executeFile('docker', ['compose', 'ps', '-q', 'db'], {
    cwd: path.resolve(import.meta.dirname, '..'),
  });
  const container = stdout.trim();
  if (!container) throw new Error('Start the local database with docker compose up -d db');
  return container;
}
function docker(args, stdio) {
  const child = spawn('docker', ['exec', '-e', 'PGPASSWORD', ...args], {
    env: pgEnvironment,
    stdio,
  });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Docker PostgreSQL client exited with status ${code}`)),
    );
  });
  return { child, done };
}
async function backupWithDocker(filename) {
  const container = await databaseContainer();
  const { child, done } = docker(
    [
      container,
      'pg_dump',
      '-h',
      '127.0.0.1',
      '-U',
      pgEnvironment.PGUSER,
      '-d',
      database,
      '-Fc',
      '--no-owner',
      '--no-privileges',
    ],
    ['ignore', 'pipe', 'inherit'],
  );
  await Promise.all([pipeline(child.stdout, createWriteStream(filename, { mode: 0o600 })), done]);
}
async function restoreWithDocker(filename) {
  const container = await databaseContainer();
  const { child, done } = docker(
    [
      '-i',
      container,
      'pg_restore',
      '-h',
      '127.0.0.1',
      '-U',
      pgEnvironment.PGUSER,
      '-d',
      database,
      '--single-transaction',
      '--exit-on-error',
      '--no-owner',
      '--no-privileges',
    ],
    ['pipe', 'inherit', 'inherit'],
  );
  await Promise.all([pipeline(createReadStream(filename), child.stdin), done]);
}

if (command === 'backup') {
  const filename = path.resolve(
    argument ||
      path.join('backups', `bookflow-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`),
  );
  const temporary = `${filename}.${process.pid}.partial`;
  await mkdir(path.dirname(filename), { recursive: true });
  try {
    await stat(filename);
    throw new Error(`Backup already exists: ${filename}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    try {
      await run('pg_dump', [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--file',
        temporary,
      ]);
    } catch (error) {
      if (error.code !== 'ENOENT' || !dockerAvailableForUrl) throw error;
      await backupWithDocker(temporary);
    }
    await chmod(temporary, 0o600);
    await link(temporary, filename);
    await rm(temporary);
    console.log(`Backup saved to ${filename}`);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
} else {
  const filename = path.resolve(argument);
  await stat(filename);
  const client = new pg.Client({ connectionString: connection });
  try {
    await client.connect();
    const {
      rows: [row],
    } = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog','information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND c.relkind IN ('r','p','v','m','S','f')
      ) OR EXISTS (
        SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql'
      ) AS populated
    `);
    if (row.populated)
      throw new Error(`Restore target ${database} already contains tables; use an empty database`);
  } finally {
    await client.end();
  }
  try {
    await run('pg_restore', [
      '--single-transaction',
      '--exit-on-error',
      '--no-owner',
      '--no-privileges',
      '--dbname',
      database,
      filename,
    ]);
  } catch (error) {
    if (error.code !== 'ENOENT' || !dockerAvailableForUrl) throw error;
    await restoreWithDocker(filename);
  }
  console.log(`Restored ${filename} into ${database}`);
}
