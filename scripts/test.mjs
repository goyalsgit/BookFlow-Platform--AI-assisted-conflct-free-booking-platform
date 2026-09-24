import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
// A disposable database per run. Never migrate, seed or truncate the development database.
const envFile = Object.fromEntries(
  readFileSync('server/.env', 'utf8')
    .split('\n')
    .filter((x) => x.includes('=') && !x.startsWith('#'))
    .map((x) => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]),
);
const url = new URL(process.env.DATABASE_URL ?? envFile.DATABASE_URL);
const testName = `bookflow_test_${process.pid}_${Date.now()}`;
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query(`CREATE DATABASE "${testName}"`);
url.pathname = '/' + testName;
const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  BOOKFLOW_TEST_DB: testName,
  JWT_SECRET: 'bookflow-test-secret-never-production',
};
try {
  const migrate = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/migrate.ts'], {
    cwd: 'server',
    env,
    stdio: 'inherit',
  });
  if (migrate.status !== 0) process.exitCode = migrate.status ?? 1;
  else {
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--test', '--test-concurrency=1', 'test/core.test.ts'],
      { cwd: 'server', env, stdio: 'inherit' },
    );
    process.exitCode = run.status ?? 1;
  }
} finally {
  await admin.query(`DROP DATABASE "${testName}" WITH (FORCE)`);
  await admin.end();
}
