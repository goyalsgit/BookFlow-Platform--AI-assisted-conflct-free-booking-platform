// Temporary local benchmark. Uses its own disposable database; never touches the dev database.
import pg from 'pg';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';

const envFile = Object.fromEntries(
  readFileSync('server/.env', 'utf8')
    .split('\n')
    .filter((x) => x.includes('=') && !x.startsWith('#'))
    .map((x) => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]),
);
const url = new URL(process.env.DATABASE_URL ?? envFile.DATABASE_URL);
const dbName = `bookflow_bench_${Date.now()}`;
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query(`CREATE DATABASE "${dbName}"`);
url.pathname = '/' + dbName;
const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}/api`;
const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  PORT: String(PORT),
  NODE_ENV: 'development',
  AI_PROVIDER: 'mock',
  NOTIFICATION_MODE: 'file',
  TRUST_PROXY: '1', // lets each simulated client have its own IP for rate limiting
};
let server;
let ip = 0;
const nextIp = () => `10.${(++ip >> 16) & 255}.${(ip >> 8) & 255}.${ip & 255}`;
const call = async (path, method = 'GET', body, token) => {
  const t = performance.now();
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { ms: performance.now() - t, status: res.status, json };
};
const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
async function load(name, total, concurrency, fn) {
  const times = [];
  const statuses = {};
  let i = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < total) {
        i++;
        const r = await fn();
        times.push(r.ms);
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
      }
    }),
  );
  const secs = (performance.now() - t0) / 1000;
  times.sort((a, b) => a - b);
  const row = {
    scenario: name,
    requests: total,
    concurrency,
    'req/s': Math.round(total / secs),
    p50: +pct(times, 50).toFixed(1),
    p95: +pct(times, 95).toFixed(1),
    p99: +pct(times, 99).toFixed(1),
    statuses: JSON.stringify(statuses),
  };
  console.log(JSON.stringify(row));
  return row;
}

try {
  for (const script of ['src/db/migrate.ts', 'src/db/seed-flow.ts']) {
    const r = spawnSync(process.execPath, ['--import', 'tsx', script], {
      cwd: 'server',
      env,
      stdio: 'ignore',
    });
    if (r.status !== 0) throw new Error(`${script} failed`);
  }
  server = spawn(process.execPath, ['dist/index.js'], { cwd: 'server', env, stdio: 'ignore' });
  for (let k = 0; k < 50; k++) {
    try {
      if ((await fetch(BASE + '/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`machine: ${cpus()[0].model} x${cpus().length}, node ${process.version}`);

  const resources = (await call('/flow/resources')).json;
  const court = resources[0];
  const serviceId = court.services[0].id;
  const date = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  const slots = (
    await call(`/flow/resources/${court.id}/slots?serviceId=${serviceId}&date=${date}`)
  ).json.slots;
  console.log(`resources=${resources.length} slotsForCourtOn${date}=${slots.length}`);

  // Warm-up
  await load('warmup', 200, 10, () => call('/flow/resources'));
  const results = [];
  results.push(await load('GET /health', 2000, 20, () => call('/health')));
  results.push(
    await load('GET /flow/resources (catalog)', 2000, 20, () => call('/flow/resources')),
  );
  results.push(
    await load('GET /resources/:id/slots (availability)', 2000, 20, () =>
      call(`/flow/resources/${court.id}/slots?serviceId=${serviceId}&date=${date}`),
    ),
  );
  results.push(
    await load('POST /recommendations (flexDays=1)', 300, 10, () =>
      call('/flow/recommendations', 'POST', {
        resourceId: court.id,
        serviceId,
        date,
        time: '18:00',
        flexDays: 1,
        allowOtherResources: true,
      }),
    ),
  );
  results.push(
    await load('POST /recommendations (flexDays=3)', 300, 10, () =>
      call('/flow/recommendations', 'POST', {
        resourceId: court.id,
        serviceId,
        date,
        time: '18:00',
        flexDays: 3,
        allowOtherResources: true,
      }),
    ),
  );

  // Customers for booking scenarios
  const tokens = [];
  for (let k = 0; k < 100; k++) {
    const r = await call('/flow/register', 'POST', {
      name: `Bench ${k}`,
      email: `bench${k}@example.test`,
      password: 'bench-password-123',
    });
    tokens.push(r.json.token);
  }

  // Contention: 100 customers race for the same slot at once.
  const target = slots[slots.length - 1].start;
  const t0 = performance.now();
  const race = await Promise.all(
    tokens.map((tk) =>
      call('/flow/holds', 'POST', { resourceId: court.id, serviceId, start: target }, tk),
    ),
  );
  const raceMs = performance.now() - t0;
  const won = race.filter((r) => r.status === 201).length;
  const conflicts = race.filter((r) => r.status === 409).length;
  const raceTimes = race.map((r) => r.ms).sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      scenario: '100 concurrent holds, same slot',
      winners: won,
      conflicts409: conflicts,
      other: race.length - won - conflicts,
      wallMs: Math.round(raceMs),
      p50: +pct(raceTimes, 50).toFixed(1),
      p95: +pct(raceTimes, 95).toFixed(1),
    }),
  );

  // Distinct slots across all resources, booked concurrently.
  const jobs = [];
  for (const r of resources)
    for (const s of r.services.slice(0, 1)) {
      const av = (await call(`/flow/resources/${r.id}/slots?serviceId=${s.id}&date=${date}`)).json;
      for (const slot of av.slots.slice(0, 6))
        jobs.push({ resourceId: r.id, serviceId: s.id, start: slot.start });
    }
  // Non-overlapping only: take every other slot per resource is not guaranteed, so count outcomes.
  let j = 0;
  const holdRes = await load(
    `POST /holds (${jobs.length} slots, ${resources.length} resources)`,
    jobs.length,
    20,
    () => {
      const job = jobs[j];
      const tk = tokens[j++ % tokens.length];
      return call('/flow/holds', 'POST', job, tk);
    },
  );
  results.push(holdRes);

  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  const overlaps = (
    await db.query(`SELECT count(*)::int AS n FROM bookings a JOIN bookings b ON a.provider_id=b.provider_id AND a.id<b.id
      AND a.status IN ('held','confirmed') AND b.status IN ('held','confirmed')
      AND tstzrange(a.blocked_start,a.blocked_end) && tstzrange(b.blocked_start,b.blocked_end)`)
  ).rows[0].n;
  console.log(`overlapping active bookings in DB after load: ${overlaps}`);
  await db.end();
} finally {
  server?.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.end();
}
