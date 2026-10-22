import { z } from 'zod';
import { pool } from '../db/pool.js';
import { lockResource } from './booking.js';
import { transaction } from '../db/transaction.js';
import { fail } from '../middleware/errors.js';
import { wallTimeToInstant } from './time.js';
import { seatKeys, solveSeats, type SeatRow } from './seatSolver.js';
import { computeSlots } from '../services/slots.js';

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const seatRow = z
  .object({
    label: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9]{0,7}$/),
    count: z.number().int().min(1).max(30),
    blocked: z.array(z.number().int().min(1).max(30)).default([]),
  })
  .strict()
  .refine(
    (row) =>
      row.blocked.every((n) => n <= row.count) && new Set(row.blocked).size === row.blocked.length,
    'Invalid blocked seats',
  );
export const publishSchema = z
  .object({
    resourceId: z.number().int().positive(),
    serviceId: z.number().int().positive(),
    startLocal: localDateTime,
    deadlineLocal: localDateTime,
    confirmationHours: z.number().int().min(1).max(48),
    rows: z.array(seatRow).min(1).max(8),
  })
  .strict()
  .refine(
    (v) => new Set(v.rows.map((r) => r.label.toUpperCase())).size === v.rows.length,
    'Row labels must be unique',
  )
  .refine(
    (v) => seatKeys(v.rows).length > 0 && seatKeys(v.rows).length <= 80,
    'A publication needs 1–80 available seats',
  );

export async function publishSeatPool(org: number, input: z.infer<typeof publishSchema>) {
  return transaction(async (db) => {
    await lockResource(db, input.resourceId);
    const {
      rows: [resource],
    } = await db.query(
      `SELECT p.*,o.timezone FROM providers p JOIN organizations o ON o.id=p.organization_id WHERE p.id=$1 AND p.organization_id=$2 AND p.active`,
      [input.resourceId, org],
    );
    if (!resource) return fail(404, 'Active resource not found');
    const {
      rows: [service],
    } = await db.query(
      `SELECT s.* FROM services s JOIN resource_services rs ON rs.service_id=s.id WHERE rs.resource_id=$1 AND s.id=$2 AND s.active`,
      [input.resourceId, input.serviceId],
    );
    if (!service) return fail(404, 'Active session not found');
    const start = wallTimeToInstant(input.startLocal, resource.timezone),
      deadline = wallTimeToInstant(input.deadlineLocal, resource.timezone);
    const end = new Date(Date.parse(start) + service.duration_min * 60000).toISOString();
    const blockedStart = new Date(
      Date.parse(start) - service.buffer_before_min * 60000,
    ).toISOString();
    const blockedEnd = new Date(Date.parse(end) + service.buffer_min * 60000).toISOString();
    if (Date.parse(deadline) <= Date.now() || Date.parse(deadline) >= Date.parse(start))
      return fail(400, 'Deadline must be in the future and before the session');
    if (Date.parse(start) > Date.now() + resource.booking_horizon_days * 86400000)
      return fail(400, 'Session is beyond the booking horizon');
    const day = input.startLocal.slice(0, 10);
    const available = await computeSlots(db, input.resourceId, input.serviceId, day);
    if (!available.slots.some((slot) => slot.start === start))
      return fail(
        409,
        'This session is outside bookable hours or conflicts with another reservation',
      );
    const {
      rows: [created],
    } = await db.query(
      `INSERT INTO seat_pools(resource_id,service_id,starts_at,ends_at,blocked_start,blocked_end,request_deadline,confirmation_hours,rows)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        input.resourceId,
        input.serviceId,
        start,
        end,
        blockedStart,
        blockedEnd,
        deadline,
        input.confirmationHours,
        JSON.stringify(input.rows),
      ],
    );
    return created;
  });
}

export async function listSeatPools(org?: number) {
  const { rows } = await pool.query(
    `SELECT sp.*,p.name AS resource_name,s.name AS service_name,o.timezone,l.name AS location_name,
 (SELECT count(*)::int FROM seat_pool_requests r WHERE r.pool_id=sp.id AND r.status='waiting') AS waiting_groups,
 (SELECT count(*)::int FROM seat_pool_requests r WHERE r.pool_id=sp.id AND r.status='confirmed') AS confirmed_groups
 FROM seat_pools sp JOIN providers p ON p.id=sp.resource_id JOIN services s ON s.id=sp.service_id JOIN organizations o ON o.id=p.organization_id JOIN locations l ON l.id=p.location_id
 WHERE sp.status='open' AND sp.starts_at>now() AND ($1::int IS NULL OR p.organization_id=$1) ORDER BY sp.starts_at,sp.id`,
    [org ?? null],
  );
  return rows;
}

export async function mySeatRequests(customerId: number) {
  const { rows } = await pool.query(
    `SELECT r.*,sp.starts_at,sp.request_deadline,p.name AS resource_name,s.name AS service_name,o.timezone
 FROM seat_pool_requests r JOIN seat_pools sp ON sp.id=r.pool_id JOIN providers p ON p.id=sp.resource_id JOIN services s ON s.id=sp.service_id JOIN organizations o ON o.id=p.organization_id
 WHERE r.customer_id=$1 ORDER BY sp.starts_at DESC,r.id DESC LIMIT 100`,
    [customerId],
  );
  return rows;
}

export async function joinSeatPool(poolId: number, customerId: number, partySize: number) {
  return transaction(async (db) => {
    const {
      rows: [published],
    } = await db.query('SELECT * FROM seat_pools WHERE id=$1 FOR UPDATE', [poolId]);
    if (!published) return fail(404, 'Seat pool not found');
    if (published.status !== 'open') return fail(409, 'This seat pool was withdrawn');
    if (Date.parse(published.request_deadline) <= Date.now())
      return fail(409, 'The request deadline has passed');
    const rows = published.rows as SeatRow[];
    if (
      !rows.some((row) =>
        Array.from({ length: row.count - partySize + 1 }, (_, i) => i + 1).some((start) =>
          Array.from({ length: partySize }, (_, i) => start + i).every(
            (n) => !row.blocked.includes(n),
          ),
        ),
      )
    )
      return fail(400, 'No row has enough adjacent seats for this group');
    const {
      rows: [existing],
    } = await db.query(
      'SELECT * FROM seat_pool_requests WHERE pool_id=$1 AND customer_id=$2 FOR UPDATE',
      [poolId, customerId],
    );
    if (existing) {
      if (existing.status !== 'cancelled')
        return fail(409, 'You already have a request for this seat pool');
      return (
        await db.query(
          `UPDATE seat_pool_requests SET status='waiting',party_size=$2,created_at=now(),assigned_seats=NULL,offer_expires_at=NULL,confirmed_at=NULL WHERE id=$1 RETURNING *`,
          [existing.id, partySize],
        )
      ).rows[0];
    }
    const {
      rows: [entry],
    } = await db.query(
      `INSERT INTO seat_pool_requests(pool_id,customer_id,party_size) VALUES($1,$2,$3) RETURNING *`,
      [poolId, customerId, partySize],
    );
    return entry;
  });
}

export async function allocateSeatPool(poolId: number, org?: number) {
  return transaction(async (db) => {
    const {
      rows: [published],
    } = await db.query(
      `SELECT sp.*,p.organization_id FROM seat_pools sp JOIN providers p ON p.id=sp.resource_id WHERE sp.id=$1 FOR UPDATE OF sp`,
      [poolId],
    );
    if (!published || (org !== undefined && published.organization_id !== org))
      return fail(404, 'Seat pool not found');
    if (published.status !== 'open') return fail(409, 'This seat pool was withdrawn');
    if (Date.parse(published.request_deadline) > Date.now())
      return fail(409, 'Allocation starts after the request deadline');
    const expired = await db.query(
      `UPDATE seat_pool_requests SET status='expired',assigned_seats=NULL,offer_expires_at=NULL
   WHERE pool_id=$1 AND status='offered' AND offer_expires_at<=clock_timestamp() RETURNING id`,
      [poolId],
    );
    if (expired.rowCount)
      await db.query(
        `DELETE FROM seat_pool_assignments WHERE pool_id=$1 AND request_id=ANY($2::int[])`,
        [poolId, expired.rows.map((r) => r.id)],
      );
    if (Date.parse(published.starts_at) <= Date.now()) {
      await db.query(
        `UPDATE seat_pool_requests SET status='expired' WHERE pool_id=$1 AND status='waiting'`,
        [poolId],
      );
      return { offers: [], expired: expired.rowCount, closed: true };
    }
    const { rows: waiting } = await db.query(
      `SELECT id,customer_id,party_size,created_at FROM seat_pool_requests WHERE pool_id=$1 AND status='waiting' ORDER BY created_at,id FOR UPDATE`,
      [poolId],
    );
    if (!waiting.length) {
      await db.query('UPDATE seat_pools SET last_allocated_at=now() WHERE id=$1', [poolId]);
      return { offers: [], expired: expired.rowCount, closed: false };
    }
    const { rows: used } = await db.query(
      'SELECT seat_key FROM seat_pool_assignments WHERE pool_id=$1',
      [poolId],
    );
    let solution;
    try {
      solution = solveSeats(
        published.rows as SeatRow[],
        waiting.map((r) => ({
          id: r.id,
          partySize: r.party_size,
          createdAt: r.created_at.toISOString(),
        })),
        used.map((r) => r.seat_key),
      );
    } catch {
      return fail(
        503,
        'Allocation could not be proven optimal yet. No new offers were sent; retry later.',
      );
    }
    const offers = [];
    for (const request of waiting) {
      const seats = solution.assignments.get(request.id);
      if (!seats) continue;
      const expires = new Date(
        Math.min(
          Date.parse(published.starts_at),
          Date.now() + published.confirmation_hours * 3600000,
        ),
      ).toISOString();
      const {
        rows: [offer],
      } = await db.query(
        `UPDATE seat_pool_requests SET status='offered',assigned_seats=$2,offer_expires_at=$3 WHERE id=$1 RETURNING *`,
        [request.id, JSON.stringify(seats), expires],
      );
      for (const seat of seats)
        await db.query(
          'INSERT INTO seat_pool_assignments(pool_id,seat_key,request_id) VALUES($1,$2,$3)',
          [poolId, seat, request.id],
        );
      await db.query(
        `INSERT INTO flow_notifications(customer_id,booking_id,title,message,dedupe_key) VALUES($1,NULL,$2,$3,$4) ON CONFLICT(dedupe_key) DO NOTHING`,
        [
          request.customer_id,
          'Adjacent seats offered',
          `Seats ${seats.join(', ')} are held until ${expires}. Confirm them in Seat pools.`,
          `seat-offer:${request.id}`,
        ],
      );
      offers.push(offer);
    }
    await db.query('UPDATE seat_pools SET last_allocated_at=now() WHERE id=$1', [poolId]);
    return {
      offers,
      expired: expired.rowCount,
      closed: false,
      proof: {
        filled: solution.filled,
        fragments: solution.fragments,
        examined: solution.examined,
      },
    };
  });
}

export async function changeSeatRequest(
  id: number,
  customerId: number,
  action: 'confirm' | 'cancel',
) {
  const result = await transaction(async (db) => {
    const {
      rows: [pre],
    } = await db.query('SELECT pool_id FROM seat_pool_requests WHERE id=$1 AND customer_id=$2', [
      id,
      customerId,
    ]);
    if (!pre) return fail(404, 'Request not found');
    const {
      rows: [published],
    } = await db.query('SELECT * FROM seat_pools WHERE id=$1 FOR UPDATE', [pre.pool_id]);
    if (published.status !== 'open') return fail(409, 'This seat pool was withdrawn');
    const {
      rows: [entry],
    } = await db.query('SELECT * FROM seat_pool_requests WHERE id=$1 FOR UPDATE', [id]);
    if (action === 'confirm') {
      if (
        entry.status !== 'offered' ||
        Date.parse(entry.offer_expires_at) <= Date.now() ||
        Date.parse(published.starts_at) <= Date.now()
      )
        return fail(409, 'Offer has expired or is no longer available');
      return {
        entry: (
          await db.query(
            `UPDATE seat_pool_requests SET status='confirmed',confirmed_at=now() WHERE id=$1 RETURNING *`,
            [id],
          )
        ).rows[0],
        poolId: pre.pool_id,
        reallocate: false,
      };
    }
    if (
      !['waiting', 'offered', 'confirmed'].includes(entry.status) ||
      Date.parse(published.starts_at) <= Date.now()
    )
      return fail(409, 'This request can no longer be cancelled');
    await db.query('DELETE FROM seat_pool_assignments WHERE pool_id=$1 AND request_id=$2', [
      pre.pool_id,
      id,
    ]);
    return {
      entry: (
        await db.query(
          `UPDATE seat_pool_requests SET status='cancelled',assigned_seats=NULL,offer_expires_at=NULL WHERE id=$1 RETURNING *`,
          [id],
        )
      ).rows[0],
      poolId: pre.pool_id,
      reallocate: Date.parse(published.request_deadline) <= Date.now(),
    };
  });
  if (result.reallocate) await allocateSeatPool(result.poolId);
  return result.entry;
}

export async function maintainSeatPools() {
  const { rows } =
    await pool.query(`SELECT DISTINCT sp.id FROM seat_pools sp JOIN seat_pool_requests r ON r.pool_id=sp.id
  WHERE sp.status='open' AND sp.request_deadline<=now() AND ((sp.last_allocated_at IS NULL AND r.status='waiting') OR (sp.starts_at<=now() AND r.status='waiting') OR (r.status='offered' AND r.offer_expires_at<=now())) ORDER BY sp.id LIMIT 30`);
  for (const row of rows)
    try {
      await allocateSeatPool(row.id);
    } catch (error) {
      console.error('Seat allocation retry needed', row.id, error);
    }
}

export async function withdrawSeatPool(poolId: number, org: number) {
  return transaction(async (db) => {
    const {
      rows: [pre],
    } = await db.query('SELECT resource_id FROM seat_pools WHERE id=$1', [poolId]);
    if (!pre) return fail(404, 'Seat pool not found');
    await lockResource(db, pre.resource_id);
    const {
      rows: [published],
    } = await db.query(
      `SELECT sp.* FROM seat_pools sp JOIN providers p ON p.id=sp.resource_id WHERE sp.id=$1 AND p.organization_id=$2 FOR UPDATE OF sp`,
      [poolId, org],
    );
    if (!published) return fail(404, 'Seat pool not found');
    if (published.status !== 'open') return fail(409, 'Seat pool already withdrawn');
    if (
      (
        await db.query(
          `SELECT 1 FROM seat_pool_requests WHERE pool_id=$1 AND status='confirmed' LIMIT 1`,
          [poolId],
        )
      ).rowCount
    )
      return fail(
        409,
        'Confirmed groups exist. Resolve those reservations before withdrawing this pool.',
      );
    const { rows: affected } = await db.query(
      `UPDATE seat_pool_requests SET status='cancelled',assigned_seats=NULL,offer_expires_at=NULL
   WHERE pool_id=$1 AND status IN ('waiting','offered') RETURNING id,customer_id`,
      [poolId],
    );
    await db.query('DELETE FROM seat_pool_assignments WHERE pool_id=$1', [poolId]);
    await db.query(`UPDATE seat_pools SET status='cancelled' WHERE id=$1`, [poolId]);
    for (const request of affected)
      await db.query(
        `INSERT INTO flow_notifications(customer_id,booking_id,title,message,dedupe_key)
   VALUES($1,NULL,'Seat pool withdrawn','The publisher withdrew this seat pool. Your request or offer was cancelled.',$2)
   ON CONFLICT(dedupe_key) DO NOTHING`,
        [request.customer_id, `seat-withdrawn:${request.id}`],
      );
    return { ok: true, cancelledRequests: affected.length };
  });
}
