import type pg from 'pg';
import { randomBytes } from 'node:crypto';
import { pool } from '../db/pool.js';
import { computeSlots } from '../services/slots.js';
import { localDate, localTime, minuteOfDay } from './time.js';
export const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};
export async function transaction<T>(work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error: any) {
    await db.query('ROLLBACK');
    if (error.code === '23P01')
      fail(409, 'SLOT_CONFLICT: That slot was just taken. Choose another option.');
    if (error.code === '23505')
      fail(409, 'This request already exists. Refresh to see its status.');
    throw error;
  } finally {
    db.release();
  }
}
export async function lockResource(db: pg.PoolClient, id: number) {
  await db.query(
    'SELECT o.id FROM organizations o JOIN providers p ON p.organization_id=o.id WHERE p.id=$1 FOR SHARE OF o',
    [id],
  );
  await db.query('SELECT pg_advisory_xact_lock(42,$1::int)', [id]);
}
export async function audit(
  db: pg.PoolClient,
  id: number,
  event: string,
  actor: string,
  detail: string,
) {
  await db.query('INSERT INTO booking_events(booking_id,event,actor,detail) VALUES($1,$2,$3,$4)', [
    id,
    event,
    actor,
    detail,
  ]);
}
export async function notify(
  db: pg.PoolClient,
  customer: number,
  booking: number,
  title: string,
  message: string,
  key: string,
) {
  await db.query(
    `INSERT INTO flow_notifications(customer_id,booking_id,title,message,dedupe_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dedupe_key) DO NOTHING`,
    [customer, booking, title, message, key],
  );
}
/** Must run under the resource lock. Expiry and its audit record commit together. */
export async function expireHolds(db: pg.PoolClient, resourceId: number) {
  const { rows } = await db.query(
    `UPDATE bookings SET status='expired',version=version+1,updated_at=now() WHERE provider_id=$1 AND status='held' AND expires_at<=clock_timestamp() RETURNING *`,
    [resourceId],
  );
  for (const b of rows) {
    await audit(db, b.id, 'expired', 'system', 'Confirmation window ended; capacity released');
    await db.query(
      `UPDATE allocation_requests SET status='expired' WHERE offered_booking_id=$1 AND status='offered'`,
      [b.id],
    );
    await notify(
      db,
      b.customer_id,
      b.id,
      'Hold expired',
      'Your temporary hold expired. You can choose another available time.',
      `expired:${b.id}`,
    );
  }
  return rows;
}
export async function insertHold(
  db: pg.PoolClient,
  resourceId: number,
  serviceId: number,
  start: string,
  customerId: number,
  actor = 'customer',
) {
  const {
    rows: [resource],
  } = await db.query(
    `SELECT o.timezone FROM providers p JOIN organizations o ON o.id=p.organization_id WHERE p.id=$1`,
    [resourceId],
  );
  if (!resource) return fail(404, 'Resource not found');
  const { slots, service } = await computeSlots(
    db,
    resourceId,
    serviceId,
    localDate(start, resource.timezone),
  );
  const slot = slots.find((s) => Date.parse(s.start) === Date.parse(start));
  if (!slot)
    return fail(409, 'SLOT_CONFLICT: That time is no longer available. Refresh your options.');
  const code = 'BF-' + randomBytes(5).toString('hex').toUpperCase();
  const {
    rows: [booking],
  } = await db.query(
    `INSERT INTO bookings(code,provider_id,service_id,customer_id,starts_at,ends_at,status,expires_at,price_cents) VALUES($1,$2,$3,$4,$5,$6,'held',clock_timestamp()+interval '5 minutes',$7) RETURNING *`,
    [code, resourceId, serviceId, customerId, slot.start, slot.end, service.price_cents],
  );
  await audit(
    db,
    booking.id,
    'held',
    actor,
    'Exclusive five-minute hold created; customer confirmation required',
  );
  return booking;
}
export async function hold(
  input: { resourceId: number; serviceId: number; start: string },
  customerId: number,
) {
  return transaction(async (db) => {
    await lockResource(db, input.resourceId);
    await expireHolds(db, input.resourceId);
    return insertHold(db, input.resourceId, input.serviceId, input.start, customerId);
  });
}
/** FIFO among compatible requests. Each offer is a real held booking, protected by the exclusion constraint. */
export async function promote(db: pg.PoolClient, resourceId: number) {
  const { rows: requests } = await db.query(
    `SELECT ar.*,o.timezone FROM allocation_requests ar JOIN providers p ON p.id=ar.resource_id JOIN organizations o ON o.id=p.organization_id WHERE ar.resource_id=$1 AND ar.status='waiting' ORDER BY ar.created_at,ar.id FOR UPDATE OF ar`,
    [resourceId],
  );
  for (const request of requests) {
    const date =
      typeof request.date === 'string'
        ? request.date.slice(0, 10)
        : localDate(request.date, request.timezone);
    let slots;
    try {
      ({ slots } = await computeSlots(db, resourceId, request.service_id, date));
    } catch (error: any) {
      if (error.status === 404) continue;
      throw error;
    }
    const slot = slots.find((s) => {
      const t = minuteOfDay(localTime(s.start, request.timezone));
      return t >= minuteOfDay(request.earliest_time) && t <= minuteOfDay(request.latest_time);
    });
    if (!slot) continue;
    const booking = await insertHold(
      db,
      resourceId,
      request.service_id,
      slot.start,
      request.customer_id,
      'waitlist',
    );
    await db.query(
      `UPDATE allocation_requests SET status='offered',offered_booking_id=$2 WHERE id=$1`,
      [request.id, booking.id],
    );
    await notify(
      db,
      request.customer_id,
      booking.id,
      'A slot is held for you',
      `A matching slot is reserved for five minutes. Confirm ${booking.code} in My bookings.`,
      `offer:${request.id}:${booking.id}`,
    );
  }
}
async function ownedLocked(db: pg.PoolClient, code: string, customerId: number) {
  const {
    rows: [pre],
  } = await db.query('SELECT provider_id FROM bookings WHERE code=$1 AND customer_id=$2', [
    code,
    customerId,
  ]);
  if (!pre) return fail(404, 'Booking not found');
  await lockResource(db, pre.provider_id);
  await expireHolds(db, pre.provider_id);
  const {
    rows: [booking],
  } = await db.query(
    `SELECT b.*,o.timezone,o.cancellation_cutoff_min,p.reschedule_cutoff_min FROM bookings b JOIN providers p ON p.id=b.provider_id JOIN organizations o ON o.id=p.organization_id WHERE b.code=$1 AND b.customer_id=$2 FOR UPDATE OF b`,
    [code, customerId],
  );
  return booking;
}
export async function changeBooking(
  code: string,
  customerId: number,
  action: 'confirm' | 'cancel' | 'reschedule',
  start?: string,
  version?: number,
) {
  const result = await transaction(async (db) => {
    const b = await ownedLocked(db, code, customerId);
    // Return errors after commit so inline expiry is not rolled back.
    if (b.status === 'expired')
      return { error: 410, message: 'Your hold expired. Please select another slot.' };
    if (version !== undefined && b.version !== version)
      return { error: 409, message: 'Booking changed. Refresh before trying again.' };
    if (action === 'confirm') {
      if (b.status === 'confirmed') return b;
      if (b.status !== 'held')
        return { error: 409, message: 'Only an active hold can be confirmed.' };
      const {
        rows: [resource],
      } = await db.query('SELECT active FROM providers WHERE id=$1', [b.provider_id]);
      if (!resource.active)
        return {
          error: 409,
          message: 'This resource is inactive. Release this hold and choose another.',
        };
      await db.query(
        `UPDATE bookings SET status='confirmed',version=version+1,updated_at=now() WHERE id=$1`,
        [b.id],
      );
      await db.query(
        `UPDATE allocation_requests SET status='confirmed' WHERE offered_booking_id=$1`,
        [b.id],
      );
      await audit(
        db,
        b.id,
        'confirmed',
        `customer:${customerId}`,
        'Customer accepted the allocation',
      );
      await notify(
        db,
        customerId,
        b.id,
        'Booking confirmed',
        `${b.code} is confirmed. Your resource is reserved.`,
        `confirmed:${b.id}`,
      );
    } else if (action === 'cancel') {
      if (b.status === 'cancelled') return b;
      if (!['held', 'confirmed'].includes(b.status))
        return { error: 409, message: 'This booking cannot be cancelled.' };
      if (
        b.status === 'confirmed' &&
        Date.parse(b.starts_at) - Date.now() < b.cancellation_cutoff_min * 60000
      )
        return {
          error: 409,
          message: `Cancellation closes ${b.cancellation_cutoff_min} minutes before the session.`,
        };
      await db.query(
        `UPDATE bookings SET status='cancelled',version=version+1,updated_at=now() WHERE id=$1`,
        [b.id],
      );
      await db.query(
        `UPDATE allocation_requests SET status='cancelled' WHERE offered_booking_id=$1 AND status='offered'`,
        [b.id],
      );
      await audit(db, b.id, 'cancelled', `customer:${customerId}`, 'Customer released capacity');
      await notify(
        db,
        customerId,
        b.id,
        'Booking cancelled',
        `${b.code} has been cancelled.`,
        `cancelled:${b.id}`,
      );
      await promote(db, b.provider_id);
    } else {
      if (b.status !== 'confirmed')
        return { error: 409, message: 'Only a confirmed booking can be rescheduled.' };
      if (Date.parse(b.starts_at) - Date.now() < b.reschedule_cutoff_min * 60000)
        return {
          error: 409,
          message: `Rescheduling closes ${b.reschedule_cutoff_min} minutes before the session.`,
        };
      const { slots } = await computeSlots(
        db,
        b.provider_id,
        b.service_id,
        localDate(start!, b.timezone),
        b.id,
      );
      const slot = slots.find((s) => Date.parse(s.start) === Date.parse(start!));
      if (!slot)
        return {
          error: 409,
          message: 'SLOT_CONFLICT: New slot is unavailable. Your original booking is unchanged.',
        };
      await db.query(
        `UPDATE bookings SET starts_at=$2,ends_at=$3,version=version+1,updated_at=now() WHERE id=$1`,
        [b.id, slot.start, slot.end],
      );
      await audit(
        db,
        b.id,
        'rescheduled',
        `customer:${customerId}`,
        `From ${new Date(b.starts_at).toISOString()} to ${slot.start}`,
      );
      await notify(
        db,
        customerId,
        b.id,
        'Booking rescheduled',
        `${b.code} has moved to your selected time.`,
        `rescheduled:${b.id}:${b.version + 1}`,
      );
      await promote(db, b.provider_id);
    }
    return (await db.query('SELECT * FROM bookings WHERE id=$1', [b.id])).rows[0];
  });
  if (result.error) return fail(result.error, result.message);
  return result;
}
export async function myBookings(customerId: number) {
  return (
    await pool.query(
      `SELECT b.*,p.name AS resource_name,p.business_type,l.name AS location_name,l.address AS location_address,s.name AS service_name,o.timezone,
 COALESCE((SELECT json_agg(e ORDER BY e.created_at,e.id) FROM booking_events e WHERE e.booking_id=b.id),'[]') AS events
 FROM bookings b JOIN providers p ON p.id=b.provider_id JOIN locations l ON l.id=p.location_id JOIN organizations o ON o.id=p.organization_id JOIN services s ON s.id=b.service_id WHERE b.customer_id=$1 ORDER BY b.created_at DESC LIMIT 100`,
      [customerId],
    )
  ).rows;
}
export async function joinQueue(
  input: {
    resourceId: number;
    serviceId: number;
    date: string;
    earliestTime: string;
    latestTime: string;
  },
  customerId: number,
) {
  return transaction(async (db) => {
    await lockResource(db, input.resourceId);
    await expireHolds(db, input.resourceId);
    const { provider } = await computeSlots(db, input.resourceId, input.serviceId, input.date);
    if (
      input.date < localDate(new Date(), provider.timezone) ||
      Date.parse(input.date) > Date.now() + provider.booking_horizon_days * 86400000
    )
      return fail(400, 'Choose a date within the booking horizon.');
    const {
      rows: [entry],
    } = await db.query(
      `INSERT INTO allocation_requests(customer_id,resource_id,service_id,date,earliest_time,latest_time) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        customerId,
        input.resourceId,
        input.serviceId,
        input.date,
        input.earliestTime,
        input.latestTime,
      ],
    );
    await promote(db, input.resourceId);
    return (await db.query('SELECT * FROM allocation_requests WHERE id=$1', [entry.id])).rows[0];
  });
}
export async function cleanup() {
  const { rows } = await pool.query(
    `SELECT DISTINCT provider_id AS id FROM bookings WHERE status='held' AND expires_at<=clock_timestamp() UNION SELECT resource_id AS id FROM allocation_requests WHERE status='waiting'`,
  );
  for (const { id } of rows)
    await transaction(async (db) => {
      await lockResource(db, id);
      await expireHolds(db, id);
      await db.query(
        `UPDATE allocation_requests ar SET status='expired' FROM providers p,organizations o WHERE ar.resource_id=p.id AND p.organization_id=o.id AND ar.resource_id=$1 AND ar.status='waiting' AND ar.date<(now() AT TIME ZONE o.timezone)::date`,
        [id],
      );
      await promote(db, id);
    });
}
