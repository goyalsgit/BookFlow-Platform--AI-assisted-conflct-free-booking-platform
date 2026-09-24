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
  const businessInbox = await request(app).get('/api/flow/admin/notifications').set(auth(adminToken));
  assert.equal(businessInbox.status, 200);
  assert.ok(businessInbox.body.some((notice: { message: string; title: string }) =>
    notice.message.includes(b.code) && notice.title === 'Booking confirmed'));
  const foreignInbox = await request(app).get('/api/flow/admin/notifications').set(auth(foreignAdminToken));
  assert.equal(foreignInbox.status, 200);
  assert.ok(!foreignInbox.body.some((notice: { message: string }) => notice.message.includes(b.code)));
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
  const response = await request(app)
    .post('/api/flow/recommendations')
    .send({
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
    email: 'owner@example.com',
    password: 'ownerpass123',
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const ownerAuth = auth(signup.body.token);
  const workspace = await request(app).get('/api/flow/workspace').set(ownerAuth);
  assert.equal(workspace.body.name, 'New Studio');
  const settings = await request(app).get('/api/flow/admin/settings').set(ownerAuth);
  assert.equal(settings.status, 200);
  assert.equal(settings.body.resources.length, 0);
  const created = await request(app).post('/api/flow/admin/resources').set(ownerAuth).send({
    name: 'Studio room', type: 'studio', locationId: settings.body.locations[0].id,
    serviceName: 'Room session', durationMinutes: 60, bufferBefore: 0,
    bufferAfter: 0, priceCents: 0,
    schedule: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '08:00', end: '20:00' })),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const service = (await pool.query('SELECT id FROM services WHERE provider_id=$1', [created.body.id])).rows[0];
  const slots = await request(app).get(`/api/flow/resources/${created.body.id}/slots`)
    .query({ serviceId: service.id, date: tomorrow });
  assert.equal(slots.status, 200);
  assert.ok(slots.body.slots.length > 0);
  const updatedLocation = await request(app)
    .put(`/api/flow/admin/locations/${settings.body.locations[0].id}`)
    .set(ownerAuth)
    .send({ name: 'Main location', address: '12 Market Road, Bengaluru' });
  assert.equal(updatedLocation.status, 200);
  const catalog = await request(app).get('/api/flow/resources');
  assert.equal(catalog.body.find((item: any) => item.id === created.body.id)?.location_address,
    '12 Market Road, Bengaluru');
  const duplicate = await request(app).post('/api/flow/admin/register').send({
    name: 'Other Owner', businessName: 'Other Studio',
    email: 'owner@example.com', password: 'ownerpass123',
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
    name: 'New Customer', email: 'newcustomer@example.com', password: 'customerpass123',
  });
  assert.equal(customerSignup.status, 201);
  assert.equal(
    (await request(app).get('/api/flow/admin/settings').set(auth(customerSignup.body.token))).status,
    401,
  );
  assert.equal(
    (await request(app).post('/api/flow/session').send({
      email: 'newcustomer@example.com', password: 'customerpass123',
    })).status,
    200,
  );
  const businessLogin = await request(app)
    .post('/api/flow/admin/session')
    .send({ email: 'admin@example.com', password: 'customer123' });
  assert.equal(businessLogin.status, 200);
  assert.equal(
    (await request(app).get('/api/flow/admin/settings').set(auth(businessLogin.body.token)))
      .status,
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
  assert.equal((await request(app).get('/api/flow/admin/place-suggestions?q=IIT').set(auth())).status, 401);
  assert.equal((await request(app).get('/api/flow/admin/place-suggestions?q=ab').set(auth(adminToken))).status, 400);
  assert.deepEqual(parsePlaces({ features: [{
    properties: { name: 'IIT', city: 'New Delhi', country: 'India' },
    geometry: { coordinates: [77.192, 28.544] },
  }] }), [{ label: 'IIT, New Delhi, India', lat: 28.544, lon: 77.192 }]);
});
test('customer profile is private and editable without changing email or business access', async () => {
  assert.equal((await request(app).get('/api/flow/profile')).status, 401);
  assert.equal((await request(app).get('/api/flow/profile').set(auth(adminToken))).status, 401);
  const before = await request(app).get('/api/flow/profile').set(auth());
  assert.equal(before.status, 200);
  assert.equal(before.body.email, 'test@example.com');
  const changed = await request(app).patch('/api/flow/profile').set(auth()).send({
    name: 'Updated Customer', phone: '+91 1234567890',
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.name, 'Updated Customer');
  assert.equal(changed.body.phone, '+91 1234567890');
  assert.equal(changed.body.email, 'test@example.com');
  assert.equal((await request(app).patch('/api/flow/profile').set(auth()).send({
    name: 'Changed Again', phone: '', email: 'other@example.com',
  })).status, 400);
  assert.equal((await request(app).get('/api/flow/admin/settings').set(auth())).status, 401);
});
