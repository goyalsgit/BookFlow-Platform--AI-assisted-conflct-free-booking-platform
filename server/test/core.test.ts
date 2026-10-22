import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db/pool.js';
import { app } from '../src/app.js';
import { signCustomerToken, signAdminToken } from '../src/middleware/auth.js';
import { computeSlots } from '../src/services/slots.js';
import { cleanup, transaction, lockResource, promote } from '../src/flow/booking.js';
import { scoreCandidate, weights } from '../src/flow/recommendations.js';
import { addDays, localDate, dateSchema } from '../src/flow/time.js';
import { parseRequest, MockProvider } from '../src/flow/assistant.js';
import { parsePlaces } from '../src/flow/places.js';
import { issueAction } from '../src/flow/accounts.js';
import { solveSeats } from '../src/flow/seatSolver.js';
import { wallTimeToInstant } from '../src/flow/time.js';
import { chat } from '../src/flow/chat.js';
import { maintenance } from '../src/flow/maintenance.js';
let customer: number,
  other: number,
  token: string,
  otherToken: string,
  adminToken: string,
  foreignAdminToken: string;
let tomorrow = addDays(localDate(new Date(), 'Asia/Kolkata'), 2);
let count = 0;
const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
before(async () => {
  assert.match(
    process.env.BOOKFLOW_TEST_DB ?? '',
    /^bookflow_test_/,
    'Tests must run through the isolated test runner',
  );
  const password = await bcrypt.hash('customer123', 4);
  const { rows } = await pool.query(
    `INSERT INTO customers(name,email,password_hash) VALUES('Test Customer','test@example.com',$1),('Other Customer','other@example.com',$1) RETURNING id`,
    [password],
  );
  customer = rows[0].id;
  other = rows[1].id;
  token = signCustomerToken({ sub: customer, email: 'test@example.com', name: 'Test' });
  otherToken = signCustomerToken({ sub: other, email: 'other@example.com', name: 'Other' });
  const {
    rows: [a],
  } = await pool.query(
    `INSERT INTO users(name,email,password_hash) VALUES('Admin','admin@example.com',$1) RETURNING id`,
    [password],
  );
  adminToken = signAdminToken({ sub: a.id, email: 'admin@example.com', name: 'Admin' });
  const {
    rows: [org],
  } = await pool.query(
    `INSERT INTO organizations(name,slug) VALUES('Other business','other') RETURNING id`,
  );
  const {
    rows: [foreign],
  } = await pool.query(
    `INSERT INTO users(name,email,password_hash,organization_id) VALUES('Foreign','foreign@example.com',$1,$2) RETURNING id`,
    [password, org.id],
  );
  foreignAdminToken = signAdminToken({
    sub: foreign.id,
    email: 'foreign@example.com',
    name: 'Foreign',
  });
});
after(() => pool.end());
test('maintenance completes against the migrated database and releases leadership', async () => {
  // Reproduce the background task that was failing in the development server.
  await maintenance();
  const db = await pool.connect();
  try {
    const { rows } = await db.query('SELECT pg_try_advisory_lock(73021,2) AS locked');
    assert.equal(rows[0].locked, true);
    await db.query('SELECT pg_advisory_unlock(73021,2)');
  } finally {
    db.release();
  }
});
test('exact seating seats all feasible groups and leaves one contiguous gap', () => {
  const solution = solveSeats(
    [{ label: 'A', count: 10, blocked: [] }],
    [
      { id: 1, partySize: 4, createdAt: '2026-01-01T00:00:00Z' },
      { id: 2, partySize: 3, createdAt: '2026-01-01T00:00:01Z' },
      { id: 3, partySize: 2, createdAt: '2026-01-01T00:00:02Z' },
    ],
    [],
  );
  assert.equal(solution.filled, 9);
  assert.equal(solution.fragments, 1);
  assert.equal(solution.assignments.size, 3);
  assert.equal(new Set([...solution.assignments.values()].flat()).size, 9);
});
test('chat is available before sign-in and a wrong current password does not invalidate the session', async () => {
  const guest = await request(app)
    .post('/api/flow/assistant/chat')
    .send({ messages: [{ role: 'user', content: 'Hello' }] });
  assert.equal(guest.status, 200);
  assert.equal(typeof guest.body.reply, 'string');
  const wrong = await request(app)
    .post('/api/flow/profile/password')
    .set(auth())
    .send({ currentPassword: 'incorrect-password', newPassword: 'a-different-password-123' });
  assert.equal(wrong.status, 401);
  assert.notEqual(wrong.body.code, 'SESSION_INVALID');
  assert.equal((await request(app).get('/api/flow/profile').set(auth())).status, 200);
});
test('Gemini chat sends the accepted JSON output enum and validates its reply', async () => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-only-key';
  try {
    const result = await chat(
      { messages: [{ role: 'user', content: 'Which sessions can I book?' }] },
      'test',
      {
        provider: 'gemini',
        fetcher: async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          assert.equal(body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  finishReason: 'STOP',
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          reply: 'Please choose a resource and time.',
                          resourceId: null,
                          serviceId: null,
                          date: null,
                          time: null,
                        }),
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          );
        },
      },
    );
    assert.equal(result.fallback, false);
    assert.equal(result.reply, 'Please choose a resource and time.');
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
});
test('publisher seat pool allocates adjacent groups after deadline and blocks direct bookings', async () => {
  const { p, s } = await fixture();
  const startLocal = `${tomorrow}T10:00`,
    deadlineLocal = `${tomorrow}T08:00`;
  const created = await request(app)
    .post('/api/flow/admin/seat-pools')
    .set(auth(adminToken))
    .send({
      resourceId: p.id,
      serviceId: s.id,
      startLocal,
      deadlineLocal,
      confirmationHours: 4,
      rows: [{ label: 'A', count: 10, blocked: [] }],
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const poolId = created.body.id;
  const blocked = await request(app)
    .post(`/api/flow/admin/resources/${p.id}/time-off`)
    .set(auth(adminToken))
    .send({ startLocal, endLocal: `${tomorrow}T11:00`, reason: 'Maintenance' });
  assert.equal(blocked.status, 409);
  const {
    rows: [third],
  } = await pool.query(
    `INSERT INTO customers(name,email,password_hash) VALUES('Third Group','third-group@example.com',$1) RETURNING id`,
    [await bcrypt.hash('group-password-123', 4)],
  );
  const thirdToken = signCustomerToken({
    sub: third.id,
    email: 'third-group@example.com',
    name: 'Third Group',
  });
  for (const [bearer, size] of [
    [token, 4],
    [otherToken, 3],
    [thirdToken, 2],
  ] as const) {
    const joined = await request(app)
      .post(`/api/flow/seat-pools/${poolId}/requests`)
      .set(auth(bearer))
      .send({ partySize: size });
    assert.equal(joined.status, 201, JSON.stringify(joined.body));
  }
  const premature = await request(app)
    .post(`/api/flow/admin/seat-pools/${poolId}/allocate`)
    .set(auth(adminToken));
  assert.equal(premature.status, 409);
  await pool.query(`UPDATE seat_pools SET request_deadline=now()-interval '1 minute' WHERE id=$1`, [
    poolId,
  ]);
  const allocated = await request(app)
    .post(`/api/flow/admin/seat-pools/${poolId}/allocate`)
    .set(auth(adminToken));
  assert.equal(allocated.status, 200, JSON.stringify(allocated.body));
  assert.equal(allocated.body.offers.length, 3);
  assert.equal(allocated.body.proof.filled, 9);
  assert.equal(allocated.body.proof.fragments, 1);
  const repeated = await request(app)
    .post(`/api/flow/admin/seat-pools/${poolId}/allocate`)
    .set(auth(adminToken));
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.offers.length, 0);
  const seats = allocated.body.offers.flatMap((offer: any) => offer.assigned_seats);
  assert.equal(new Set(seats).size, 9);
  const overlap = await request(app)
    .post('/api/flow/holds')
    .set(auth())
    .send({
      resourceId: p.id,
      serviceId: s.id,
      start: wallTimeToInstant(startLocal, 'Asia/Kolkata'),
    });
  assert.equal(overlap.status, 409);
  const confirmation = await request(app)
    .post(`/api/flow/seat-pool-requests/${allocated.body.offers[0].id}/confirm`)
    .set(auth());
  assert.equal(confirmation.status, 200);
  assert.equal(confirmation.body.status, 'confirmed');
  assert.equal(
    (await request(app).delete(`/api/flow/admin/seat-pools/${poolId}`).set(auth(adminToken)))
      .status,
    409,
  );
});
test('publisher can withdraw an unconfirmed pool and restore direct availability', async () => {
  const { p, s } = await fixture();
  const startLocal = `${tomorrow}T12:00`;
  const created = await request(app)
    .post('/api/flow/admin/seat-pools')
    .set(auth(adminToken))
    .send({
      resourceId: p.id,
      serviceId: s.id,
      startLocal,
      deadlineLocal: `${tomorrow}T08:00`,
      confirmationHours: 2,
      rows: [{ label: 'A', count: 6, blocked: [] }],
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const withdrawn = await request(app)
    .delete(`/api/flow/admin/seat-pools/${created.body.id}`)
    .set(auth(adminToken));
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.ok, true);
  const open = await request(app).get('/api/flow/seat-pools');
  assert.equal(
    open.body.some((entry: any) => entry.id === created.body.id),
    false,
  );
  const held = await request(app)
    .post('/api/flow/holds')
    .set(auth())
    .send({
      resourceId: p.id,
      serviceId: s.id,
      start: wallTimeToInstant(startLocal, 'Asia/Kolkata'),
    });
  assert.equal(held.status, 201, JSON.stringify(held.body));
});
async function fixture(before = 0, after = 0) {
  const n = ++count;
  const {
    rows: [p],
  } = await pool.query(
    `INSERT INTO providers(name,business_type,slot_step_min,min_lead_min,booking_horizon_days,reschedule_cutoff_min) VALUES($1,$2,15,0,365,0) RETURNING *`,
    [`Test resource ${n}`, `test_${n}`],
  );
  const {
    rows: [s],
  } = await pool.query(
    `INSERT INTO services(provider_id,name,duration_min,buffer_before_min,buffer_min) VALUES($1,'Session',60,$2,$3) RETURNING *`,
    [p.id, before, after],
  );
  await pool.query(
    `INSERT INTO schedules(provider_id,weekday,start_time,end_time) SELECT $1,d,'00:00','23:59' FROM generate_series(0,6) d`,
    [p.id],
  );
  const { slots } = await computeSlots(pool, p.id, s.id, tomorrow);
  return { p, s, slots, input: { resourceId: p.id, serviceId: s.id, start: slots[8].start } };
}
async function makeHold(input: unknown, t = token) {
  return request(app).post('/api/flow/holds').set(auth(t)).send(input);
}
async function change(code: string, action: string, body = {}, t = token) {
  return request(app).post(`/api/flow/bookings/${code}/${action}`).set(auth(t)).send(body);
}

test('20 concurrent requests: exactly one hold succeeds and 19 return 409', async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 20 }, () => makeHold(f.input)));
  assert.equal(
    results.filter((r) => r.status === 201).length,
    1,
    JSON.stringify(results.map((r) => r.body)),
  );
  assert.equal(results.filter((r) => r.status === 409).length, 19);
  const {
    rows: [n],
  } = await pool.query(
    `SELECT count(*)::int AS n FROM bookings WHERE provider_id=$1 AND status='held'`,
    [f.p.id],
  );
  assert.equal(n.n, 1);
});
test('database accepts adjacent half-open ranges and rejects overlap even with raw SQL', async () => {
  const f = await fixture();
  const b = (await makeHold(f.input)).body;
  assert.equal(b.status, 'held');
  const insert = (code: string, start: Date) =>
    pool.query(
      `INSERT INTO bookings(code,provider_id,service_id,customer_id,starts_at,ends_at,status) VALUES($1,$2,$3,$4,$5,$6,'confirmed')`,
      [code, f.p.id, f.s.id, customer, start, new Date(start.getTime() + 3600000)],
    );
  await insert('TEST-ADJACENT', new Date(b.ends_at));
  await assert.rejects(insert('TEST-OVERLAP', new Date(Date.parse(b.starts_at) + 1800000)), {
    code: '23P01',
  });
});
test('database blocked range protects both services buffers', async () => {
  const f = await fixture(15, 15);
  const b = (await makeHold(f.input)).body;
  assert.equal(Date.parse(b.starts_at) - Date.parse(b.blocked_start), 15 * 60000);
  assert.equal(Date.parse(b.blocked_end) - Date.parse(b.ends_at), 15 * 60000);
  const result = await makeHold({ ...f.input, start: b.ends_at });
  assert.equal(result.status, 409);
  await assert.rejects(
    pool.query(
      `INSERT INTO bookings(code,provider_id,service_id,customer_id,starts_at,ends_at,status) VALUES('TEST-BUFFER',$1,$2,$3,$4,$5,'confirmed')`,
      [f.p.id, f.s.id, customer, b.ends_at, new Date(Date.parse(b.ends_at) + 3600000)],
    ),
    { code: '23P01' },
  );
});
test('confirmation is idempotent, authorization enforced, cancel releases capacity and all transitions audited', async () => {
  const f = await fixture();
  const b = (await makeHold(f.input)).body;
  assert.equal((await change(b.code, 'confirm', {}, otherToken)).status, 404);
  assert.equal((await change(b.code, 'confirm')).body.status, 'confirmed');
  assert.equal((await change(b.code, 'confirm')).status, 200);
  assert.equal((await change(b.code, 'cancel')).body.status, 'cancelled');
  assert.equal((await makeHold(f.input)).status, 201);
  const events = (
    await pool.query('SELECT event FROM booking_events WHERE booking_id=$1 ORDER BY id', [b.id])
  ).rows.map((r) => r.event);
  assert.deepEqual(events, ['held', 'confirmed', 'cancelled']);
  assert.equal(
    (
      await pool.query(`SELECT count(*)::int n FROM flow_notifications WHERE dedupe_key=$1`, [
        `confirmed:${b.id}`,
      ])
    ).rows[0].n,
    1,
  );
  const businessInbox = await request(app)
    .get('/api/flow/admin/notifications')
    .set(auth(adminToken));
  assert.equal(businessInbox.status, 200);
  assert.ok(
    businessInbox.body.some(
      (notice: { message: string; title: string }) =>
        notice.message.includes(b.code) && notice.title === 'Booking confirmed',
    ),
  );
  const foreignInbox = await request(app)
    .get('/api/flow/admin/notifications')
    .set(auth(foreignAdminToken));
  assert.equal(foreignInbox.status, 200);
  assert.ok(
    !foreignInbox.body.some((notice: { message: string }) => notice.message.includes(b.code)),
  );
  assert.equal((await request(app).get('/api/flow/admin/notifications').set(auth())).status, 401);
});
test('expired hold cannot confirm; inline expiry commits and capacity can be reclaimed', async () => {
  const f = await fixture();
  const b = (await makeHold(f.input)).body;
  await pool.query(`UPDATE bookings SET expires_at=now()-interval '1 second' WHERE id=$1`, [b.id]);
  assert.equal((await change(b.code, 'confirm')).status, 410);
  assert.equal(
    (await pool.query('SELECT status FROM bookings WHERE id=$1', [b.id])).rows[0].status,
    'expired',
  );
  assert.equal((await makeHold(f.input)).status, 201);
});
test('failed rescheduling preserves the original; successful reschedule increments version', async () => {
  const f = await fixture();
  const a = (await makeHold(f.input)).body;
  await change(a.code, 'confirm');
  const occupied = f.slots[16].start;
  await makeHold({ ...f.input, start: occupied });
  assert.equal((await change(a.code, 'reschedule', { start: occupied })).status, 409);
  const unchanged = (await pool.query('SELECT * FROM bookings WHERE id=$1', [a.id])).rows[0];
  assert.equal(unchanged.starts_at.toISOString(), a.starts_at);
  const moved = await change(a.code, 'reschedule', {
    start: f.slots[24].start,
    version: unchanged.version,
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.version, unchanged.version + 1);
  assert.equal(
    (await change(a.code, 'reschedule', { start: f.slots[32].start, version: unchanged.version }))
      .status,
    409,
  );
});
test('waitlist promotion offers one protected hold; expiry advances FIFO and duplicate invocations are safe', async () => {
  const f = await fixture();
  const b = (await makeHold(f.input)).body;
  await change(b.code, 'confirm');
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(f.input.start));
  const input = {
    resourceId: f.p.id,
    serviceId: f.s.id,
    date: tomorrow,
    earliestTime: time,
    latestTime: time,
  };
  assert.equal(
    (await request(app).post('/api/flow/requests').set(auth()).send(input)).body.status,
    'waiting',
  );
  const queue = await request(app).get('/api/flow/requests').set(auth());
  assert.equal(queue.status, 200);
  assert.equal(
    queue.body.find((entry: any) => entry.resource_id === f.p.id).timezone,
    'Asia/Kolkata',
  );
  assert.equal(
    (await request(app).post('/api/flow/requests').set(auth(otherToken)).send(input)).body.status,
    'waiting',
  );
  assert.equal((await change(b.code, 'cancel')).status, 200);
  let rows = (
    await pool.query('SELECT * FROM allocation_requests WHERE resource_id=$1 ORDER BY id', [f.p.id])
  ).rows;
  assert.equal(rows[0].status, 'offered');
  assert.equal(rows[1].status, 'waiting');
  await Promise.all(
    Array.from({ length: 3 }, () =>
      transaction(async (db) => {
        await lockResource(db, f.p.id);
        await promote(db, f.p.id);
      }),
    ),
  );
  assert.equal(
    (
      await pool.query(
        `SELECT count(*)::int n FROM bookings WHERE provider_id=$1 AND status='held'`,
        [f.p.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal((await makeHold(f.input, otherToken)).status, 409);
  await pool.query(`UPDATE bookings SET expires_at=now()-interval '1 second' WHERE id=$1`, [
    rows[0].offered_booking_id,
  ]);
  await cleanup();
  rows = (
    await pool.query('SELECT * FROM allocation_requests WHERE resource_id=$1 ORDER BY id', [f.p.id])
  ).rows;
  assert.equal(rows[0].status, 'expired');
  assert.equal(rows[1].status, 'offered');
  const offer = (
    await pool.query('SELECT * FROM bookings WHERE id=$1', [rows[1].offered_booking_id])
  ).rows[0];
  const accepts = await Promise.all([
    change(offer.code, 'confirm', {}, otherToken),
    change(offer.code, 'confirm', {}, otherToken),
  ]);
  assert.ok(accepts.every((a) => a.status === 200));
  assert.equal(
    (
      await pool.query(
        `SELECT count(*)::int n FROM booking_events WHERE booking_id=$1 AND event='confirmed'`,
        [offer.id],
      )
    ).rows[0].n,
    1,
  );
});
test('availability excludes breaks, time off, inactive resources and invalid dates', async () => {
  const f = await fixture(15, 15);
  await pool.query(`INSERT INTO time_off(provider_id,starts_at,ends_at) VALUES($1,$2,$3)`, [
    f.p.id,
    f.slots[8].start,
    f.slots[8].end,
  ]);
  const { slots } = await computeSlots(pool, f.p.id, f.s.id, tomorrow);
  assert.ok(!slots.some((s) => s.start === f.slots[8].start));
  const weekday = new Date(tomorrow + 'T12:00:00Z').getUTCDay();
  await pool.query(
    `INSERT INTO breaks(provider_id,weekday,start_time,end_time) VALUES($1,$2,'12:00','13:00')`,
    [f.p.id, weekday],
  );
  const afterBreak = (await computeSlots(pool, f.p.id, f.s.id, tomorrow)).slots;
  assert.ok(
    afterBreak.every((s) => {
      const time = new Date(Date.parse(s.start) + 330 * 60000).toISOString().slice(11, 16);
      return time <= '10:45' || time >= '13:15';
    }),
  );
  assert.throws(() => dateSchema.parse('2026-02-30'));
  await pool.query('UPDATE providers SET active=false WHERE id=$1', [f.p.id]);
  await assert.rejects(computeSlots(pool, f.p.id, f.s.id, tomorrow), { status: 404 });
});
test('DST spring-forward generates no nonexistent wall-clock slots, fall-back includes both instants', async () => {
  const f = await fixture();
  const {
    rows: [org],
  } = await pool.query(
    `INSERT INTO organizations(name,slug,timezone) VALUES('DST','dst','America/New_York') RETURNING id`,
  );
  await pool.query('UPDATE providers SET organization_id=$2 WHERE id=$1', [f.p.id, org.id]);
  const spring = (await computeSlots(pool, f.p.id, f.s.id, '2027-03-14')).slots;
  assert.ok(spring.length > 0);
  assert.ok(
    spring.every(
      (s) =>
        new Intl.DateTimeFormat('en-GB', {
          timeZone: 'America/New_York',
          hour: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(s.start)) !== '02',
    ),
  );
  const fall = (await computeSlots(pool, f.p.id, f.s.id, '2026-11-01')).slots;
  const oneThirty = fall.filter(
    (s) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(s.start)) === '01:30',
  );
  assert.equal(oneThirty.length, 2);
  assert.equal(Date.parse(oneThirty[1].start) - Date.parse(oneThirty[0].start), 3600000);
});
test('ranker normalizes components, respects weighting and only returns verified slots', async () => {
  assert.equal(
    Object.values(weights).reduce((a, b) => a + b, 0),
    1,
  );
  assert.ok(
    scoreCandidate(0, 0, true, true, 0).score > scoreCandidate(60, 1, false, false, 8).score,
  );
  const f = await fixture();
  const response = await request(app).post('/api/flow/recommendations').send({
    resourceId: f.p.id,
    serviceId: f.s.id,
    date: tomorrow,
    time: '12:00',
    flexDays: 0,
    allowOtherResources: false,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.candidates.length, 5);
  assert.ok(
    response.body.candidates.every(
      (c: any) => f.slots.some((s) => s.start === c.start) && c.score >= 0 && c.score <= 1,
    ),
  );
});
test('customer token cannot access admin; administrators cannot edit another organization resource', async () => {
  const f = await fixture();
  assert.equal((await request(app).get('/api/flow/admin/operations').set(auth())).status, 401);
  assert.equal(
    (
      await request(app)
        .patch('/api/flow/admin/resources/' + f.p.id)
        .set(auth(foreignAdminToken))
        .send({ active: false })
    ).status,
    404,
  );
  const foreign = await request(app).get('/api/flow/admin/operations').set(auth(foreignAdminToken));
  assert.equal(foreign.status, 200);
  assert.equal(foreign.body.bookings.length, 0);
});
test('custom resource types are bookable; schedule edits cannot invalidate reservations', async () => {
  const data = {
    name: 'Sewing machine',
    type: 'sewing_machine',
    locationId: 1,
    serviceName: 'Rental',
    durationMinutes: 30,
    bufferBefore: 5,
    bufferAfter: 10,
    priceCents: 20000,
    schedule: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      start: '08:00',
      end: '20:00',
    })),
  };
  const created = await request(app)
    .post('/api/flow/admin/resources')
    .set(auth(adminToken))
    .send(data);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const resource = created.body;
  const service = (await pool.query('SELECT id FROM services WHERE provider_id=$1', [resource.id]))
    .rows[0];
  const { slots } = await computeSlots(pool, resource.id, service.id, tomorrow);
  assert.ok(slots.length > 0);
  await makeHold({ resourceId: resource.id, serviceId: service.id, start: slots[0].start });
  const edit = await request(app)
    .put(`/api/flow/admin/resources/${resource.id}/schedule`)
    .set(auth(adminToken))
    .send([]);
  assert.equal(edit.status, 409);
});
test('business signup creates an isolated workspace and can publish available slots', async () => {
  const signup = await request(app).post('/api/flow/admin/register').send({
    name: 'Studio Owner',
    businessName: 'New Studio',
    businessType: 'Salon',
    email: 'owner@example.com',
    password: 'ownerpass123',
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const ownerAuth = auth(signup.body.token);
  const workspace = await request(app).get('/api/flow/workspace').set(ownerAuth);
  assert.equal(workspace.body.name, 'New Studio');
  assert.equal(workspace.body.business_type, 'Salon');
  const settings = await request(app).get('/api/flow/admin/settings').set(ownerAuth);
  assert.equal(settings.status, 200);
  assert.equal(settings.body.organization.business_type, 'Salon');
  assert.equal(settings.body.resources.length, 0);
  const updatedBusiness = await request(app).put('/api/flow/admin/settings').set(ownerAuth).send({
    name: 'New Studio',
    businessType: 'Beauty salon',
    timezone: settings.body.organization.timezone,
    cancellationCutoffMinutes: settings.body.organization.cancellation_cutoff_min,
  });
  assert.equal(updatedBusiness.status, 200, JSON.stringify(updatedBusiness.body));
  assert.equal(updatedBusiness.body.business_type, 'Beauty salon');
  const created = await request(app)
    .post('/api/flow/admin/resources')
    .set(ownerAuth)
    .send({
      name: 'Studio room',
      type: 'studio',
      locationId: settings.body.locations[0].id,
      serviceName: 'Room session',
      durationMinutes: 60,
      bufferBefore: 0,
      bufferAfter: 0,
      priceCents: 0,
      schedule: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        start: '08:00',
        end: '20:00',
      })),
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(
    (
      await request(app)
        .patch(`/api/flow/admin/resources/${created.body.id}`)
        .set(auth(adminToken))
        .send({ active: false })
    ).status,
    404,
  );
  const service = (
    await pool.query('SELECT id FROM services WHERE provider_id=$1', [created.body.id])
  ).rows[0];
  const slots = await request(app)
    .get(`/api/flow/resources/${created.body.id}/slots`)
    .query({ serviceId: service.id, date: tomorrow });
  assert.equal(slots.status, 200);
  assert.ok(slots.body.slots.length > 0);
  const updatedLocation = await request(app)
    .put(`/api/flow/admin/locations/${settings.body.locations[0].id}`)
    .set(ownerAuth)
    .send({ name: 'Main location', address: '12 Market Road, Bengaluru' });
  assert.equal(updatedLocation.status, 200);
  const catalog = await request(app).get('/api/flow/resources');
  assert.equal(
    catalog.body.find((item: any) => item.id === created.body.id)?.location_address,
    '12 Market Road, Bengaluru',
  );
  const duplicate = await request(app).post('/api/flow/admin/register').send({
    name: 'Other Owner',
    businessName: 'Other Studio',
    businessType: 'Salon',
    email: 'owner@example.com',
    password: 'ownerpass123',
  });
  assert.equal(duplicate.status, 409);
  const orphan = await pool.query('SELECT id FROM organizations WHERE name=$1', ['Other Studio']);
  assert.equal(orphan.rowCount, 0, 'failed owner signup must roll back its organization');
});
test('assistant disabled, valid mock, malformed, extra actions and timeout fall back safely', async () => {
  assert.equal((await parseRequest('anything', 'Asia/Kolkata', 'disabled')).fallback, true);
  const valid = await parseRequest(
    'a court tomorrow at 6 pm for 90 minutes',
    'Asia/Kolkata',
    'mock',
  );
  assert.equal(valid.fallback, false);
  assert.equal(valid.preferences.time, '18:00');
  const malicious = await parseRequest('x', 'UTC', 'mock', {
    parse: async () => ({ action: 'book', confidence: 1, missingFields: [] }) as any,
  });
  assert.equal(malicious.fallback, true);
  const malformed = await parseRequest('x', 'UTC', 'mock', {
    parse: async () => 'bad json' as any,
  });
  assert.equal(malformed.fallback, true);
  const timeout = await parseRequest('x', 'UTC', 'mock', { parse: () => new Promise(() => {}) });
  assert.equal(timeout.fallback, true);
});
test('API validation rejects illegal input; authentication checks password', async () => {
  const customerSignup = await request(app).post('/api/flow/register').send({
    name: 'New Customer',
    email: 'newcustomer@example.com',
    password: 'customerpass123',
  });
  assert.equal(customerSignup.status, 201);
  assert.equal(
    (await request(app).get('/api/flow/admin/settings').set(auth(customerSignup.body.token)))
      .status,
    401,
  );
  assert.equal(
    (
      await request(app).post('/api/flow/session').send({
        email: 'newcustomer@example.com',
        password: 'customerpass123',
      })
    ).status,
    200,
  );
  const businessLogin = await request(app)
    .post('/api/flow/admin/session')
    .send({ email: 'admin@example.com', password: 'customer123' });
  assert.equal(businessLogin.status, 200);
  assert.equal(
    (await request(app).get('/api/flow/admin/settings').set(auth(businessLogin.body.token))).status,
    200,
  );
  assert.equal(
    (
      await request(app)
        .post('/api/flow/admin/session')
        .send({ email: 'admin@example.com', password: 'wrongpass' })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(app)
        .post('/api/flow/session')
        .send({ email: 'test@example.com', password: 'wrongpass' })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(app)
        .post('/api/flow/session')
        .send({ email: 'test@example.com', password: 'customer123' })
    ).status,
    200,
  );
  assert.equal((await request(app).post('/api/flow/holds').send({})).status, 401);
  assert.equal(
    (
      await request(app)
        .post('/api/flow/holds')
        .set(auth())
        .send({ resourceId: -1, serviceId: 1, start: 'yesterday' })
    ).status,
    400,
  );
});
test('place suggestions require a business session and valid search text', async () => {
  assert.equal((await request(app).get('/api/flow/admin/place-suggestions?q=IIT')).status, 401);
  assert.equal(
    (await request(app).get('/api/flow/admin/place-suggestions?q=IIT').set(auth())).status,
    401,
  );
  assert.equal(
    (await request(app).get('/api/flow/admin/place-suggestions?q=ab').set(auth(adminToken))).status,
    400,
  );
  assert.deepEqual(
    parsePlaces({
      features: [
        {
          properties: { name: 'IIT', city: 'New Delhi', country: 'India' },
          geometry: { coordinates: [77.192, 28.544] },
        },
      ],
    }),
    [{ label: 'IIT, New Delhi, India', lat: 28.544, lon: 77.192 }],
  );
});
test('customer profile is private and editable without changing email or business access', async () => {
  assert.equal((await request(app).get('/api/flow/profile')).status, 401);
  assert.equal((await request(app).get('/api/flow/profile').set(auth(adminToken))).status, 401);
  const before = await request(app).get('/api/flow/profile').set(auth());
  assert.equal(before.status, 200);
  assert.equal(before.body.email, 'test@example.com');
  const changed = await request(app).patch('/api/flow/profile').set(auth()).send({
    name: 'Updated Customer',
    phone: '+91 1234567890',
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.name, 'Updated Customer');
  assert.equal(changed.body.phone, '+91 1234567890');
  assert.equal(changed.body.email, 'test@example.com');
  assert.equal(
    (
      await request(app).patch('/api/flow/profile').set(auth()).send({
        name: 'Changed Again',
        phone: '',
        email: 'other@example.com',
      })
    ).status,
    400,
  );
  assert.equal((await request(app).get('/api/flow/admin/settings').set(auth())).status, 401);
});
test('password changes and logout revoke previously issued sessions', async () => {
  const email = `session-${Date.now()}@example.com`;
  const registered = await request(app).post('/api/flow/register').send({
    name: 'Session Test',
    email,
    password: 'original-password-123',
  });
  assert.equal(registered.status, 201);
  const first = auth(registered.body.token);
  assert.equal(
    (
      await request(app).post('/api/flow/profile/password').set(first).send({
        currentPassword: 'incorrect-password',
        newPassword: 'replacement-password-123',
      })
    ).status,
    401,
  );
  assert.equal((await request(app).get('/api/flow/profile').set(first)).status, 200);
  assert.equal(
    (
      await request(app).post('/api/flow/profile/password').set(first).send({
        currentPassword: 'original-password-123',
        newPassword: 'replacement-password-123',
      })
    ).status,
    204,
  );
  assert.equal((await request(app).get('/api/flow/profile').set(first)).status, 401);
  assert.equal(
    (
      await request(app)
        .post('/api/flow/session')
        .send({ email, password: 'original-password-123' })
    ).status,
    401,
  );
  const signedIn = await request(app)
    .post('/api/flow/session')
    .send({ email, password: 'replacement-password-123' });
  assert.equal(signedIn.status, 200);
  const second = auth(signedIn.body.token);
  assert.equal((await request(app).post('/api/flow/logout').set(second)).status, 204);
  assert.equal((await request(app).get('/api/flow/profile').set(second)).status, 401);
});
test('business password changes revoke owner access', async () => {
  const email = `owner-session-${Date.now()}@example.com`;
  const registered = await request(app).post('/api/flow/admin/register').send({
    name: 'Session Owner',
    businessName: 'Session Business',
    businessType: 'Clinic',
    email,
    password: 'original-password-123',
  });
  assert.equal(registered.status, 201);
  const first = auth(registered.body.token);
  assert.equal(
    (
      await request(app).post('/api/flow/admin/password').set(first).send({
        currentPassword: 'original-password-123',
        newPassword: 'replacement-password-123',
      })
    ).status,
    204,
  );
  assert.equal((await request(app).get('/api/flow/admin/settings').set(first)).status, 401);
  const signedIn = await request(app)
    .post('/api/flow/admin/session')
    .send({ email, password: 'replacement-password-123' });
  assert.equal(signedIn.status, 200);
  const second = auth(signedIn.body.token);
  assert.equal((await request(app).post('/api/flow/admin/logout').set(second)).status, 204);
  assert.equal((await request(app).get('/api/flow/admin/settings').set(second)).status, 401);
});
test('email verification and password recovery use one-time expiring links', async () => {
  const email = `recovery-${Date.now()}@example.com`;
  const registered = await request(app).post('/api/flow/register').send({
    name: 'Recovery Test',
    email,
    password: 'original-password-123',
  });
  assert.equal(registered.status, 201);
  const {
    rows: [account],
  } = await pool.query('SELECT id,email_verified_at FROM customers WHERE email=$1', [email]);
  assert.equal(account.email_verified_at, null);
  const verifyToken = await issueAction('customer', account.id, email, 'verify');
  assert.equal(
    (await request(app).post('/api/flow/account/verify').send({ token: verifyToken })).status,
    204,
  );
  assert.equal(
    (await request(app).post('/api/flow/account/verify').send({ token: verifyToken })).status,
    400,
  );
  assert.ok(
    (await pool.query('SELECT email_verified_at FROM customers WHERE id=$1', [account.id])).rows[0]
      .email_verified_at,
  );
  assert.equal(
    (
      await request(app)
        .post('/api/flow/account/reset-request')
        .send({ email: 'unknown@example.com', kind: 'customer' })
    ).status,
    202,
  );
  const resetToken = await issueAction('customer', account.id, email, 'reset');
  assert.equal(
    (
      await request(app)
        .post('/api/flow/account/reset')
        .send({ token: resetToken, newPassword: 'replacement-password-123' })
    ).status,
    204,
  );
  assert.equal(
    (
      await request(app)
        .post('/api/flow/account/reset')
        .send({ token: resetToken, newPassword: 'another-password-123' })
    ).status,
    400,
  );
  assert.equal(
    (await request(app).get('/api/flow/profile').set(auth(registered.body.token))).status,
    401,
  );
  assert.equal(
    (
      await request(app)
        .post('/api/flow/session')
        .send({ email, password: 'original-password-123' })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(app)
        .post('/api/flow/session')
        .send({ email, password: 'replacement-password-123' })
    ).status,
    200,
  );
});
