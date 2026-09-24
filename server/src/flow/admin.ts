import { pool } from '../db/pool.js';
import { transaction, lockResource, audit, fail, promote } from './booking.js';
export async function operations(organizationId: number) {
  const { rows: bookings } = await pool.query(
    `SELECT b.id,b.code,b.starts_at,b.ends_at,b.status,b.version,p.id AS resource_id,p.name AS resource_name,s.name AS service_name,c.name AS customer_name FROM bookings b JOIN providers p ON p.id=b.provider_id JOIN services s ON s.id=b.service_id JOIN customers c ON c.id=b.customer_id WHERE p.organization_id=$1 ORDER BY b.starts_at DESC LIMIT 200`,
    [organizationId],
  );
  const {
    rows: [metrics],
  } = await pool.query(
    `SELECT count(*)::int AS total,count(*) FILTER(WHERE b.status='confirmed')::int AS confirmed,count(*) FILTER(WHERE b.status='held' AND b.expires_at>now())::int AS held,count(*) FILTER(WHERE b.status='cancelled')::int AS cancelled,count(*) FILTER(WHERE b.status='completed')::int AS completed,count(*) FILTER(WHERE b.status='no_show')::int AS no_show,COALESCE(round(avg(extract(epoch FROM(b.starts_at-b.created_at))/3600) FILTER(WHERE b.status IN('confirmed','completed')),1),0)::float AS average_lead_hours FROM bookings b JOIN providers p ON p.id=b.provider_id WHERE p.organization_id=$1`,
    [organizationId],
  );
  const { rows: queue } = await pool.query(
    `SELECT ar.id,ar.status,ar.date,ar.earliest_time,ar.latest_time,ar.created_at,p.name AS resource_name,c.name AS customer_name FROM allocation_requests ar JOIN providers p ON p.id=ar.resource_id JOIN customers c ON c.id=ar.customer_id WHERE p.organization_id=$1 ORDER BY ar.created_at DESC LIMIT 100`,
    [organizationId],
  );
  const { rows: auditTrail } = await pool.query(
    `SELECT e.*,b.code,p.name AS resource_name FROM booking_events e JOIN bookings b ON b.id=e.booking_id JOIN providers p ON p.id=b.provider_id WHERE p.organization_id=$1 ORDER BY e.id DESC LIMIT 50`,
    [organizationId],
  );
  // Indicative commitment: weekly scheduled windows; denominator excludes no breaks or time off.
  const { rows: utilization } = await pool.query(
    `SELECT p.id,p.name,COALESCE((SELECT sum(extract(epoch FROM (LEAST(b.ends_at,now()+interval '7 days')-GREATEST(b.starts_at,now()))))/3600 FROM bookings b WHERE b.provider_id=p.id AND b.status IN('confirmed','completed') AND b.starts_at<now()+interval '7 days' AND b.ends_at>now()),0)::float AS booked_hours,
 COALESCE((SELECT sum(extract(epoch FROM(end_time-start_time)))/3600 FROM schedules s WHERE s.provider_id=p.id),0)::float AS scheduled_hours FROM providers p WHERE p.organization_id=$1 AND p.active ORDER BY p.id`,
    [organizationId],
  );
  return { bookings, metrics, queue, auditTrail, utilization };
}
export async function updateResource(
  id: number,
  organizationId: number,
  input: { active: boolean },
) {
  return transaction(async (db) => {
    await lockResource(db, id);
    const {
      rows: [r],
    } = await db.query(
      'UPDATE providers SET active=$3 WHERE id=$1 AND organization_id=$2 RETURNING *',
      [id, organizationId, input.active],
    );
    if (!r) fail(404, 'Resource not found');
    return r;
  });
}
export async function finishBooking(
  id: number,
  organizationId: number,
  status: 'completed' | 'no_show',
  actor: string,
) {
  return transaction(async (db) => {
    const {
      rows: [pre],
    } = await db.query(
      'SELECT b.provider_id FROM bookings b JOIN providers p ON p.id=b.provider_id WHERE b.id=$1 AND p.organization_id=$2',
      [id, organizationId],
    );
    if (!pre) return fail(404, 'Booking not found');
    await lockResource(db, pre.provider_id);
    const {
      rows: [b],
    } = await db.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [id]);
    if (b.status !== 'confirmed' || Date.parse(b.ends_at) > Date.now())
      return fail(409, 'Only a finished, confirmed session can be marked complete or no-show.');
    const {
      rows: [updated],
    } = await db.query(
      'UPDATE bookings SET status=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',
      [id, status],
    );
    await audit(db, id, status, actor, 'Session outcome recorded');
    return updated;
  });
}
export async function blockTime(
  id: number,
  org: number,
  start: string,
  end: string,
  reason: string,
  timezone?: string,
) {
  return transaction(async (db) => {
    await lockResource(db, id);
    const {
      rows: [r],
    } = await db.query('SELECT p.id,o.timezone FROM providers p JOIN organizations o ON o.id=p.organization_id WHERE p.id=$1 AND p.organization_id=$2', [id, org]);
    if (!r) return fail(404, 'Resource not found');
    if(timezone && r.timezone!==timezone)return fail(409,'Business timezone changed. Refresh and try again.');
    const conflict = await db.query(
      `SELECT 1 FROM bookings WHERE provider_id=$1 AND status IN('held','confirmed') AND (status<>'held' OR expires_at>now()) AND blocked_start<$3 AND blocked_end>$2`,
      [id, start, end],
    );
    if (conflict.rowCount)
      return fail(
        409,
        'Existing reservations overlap this time off. Resolve those reservations first.',
      );
    return (
      await db.query(
        'INSERT INTO time_off(provider_id,starts_at,ends_at,reason) VALUES($1,$2,$3,$4) RETURNING *',
        [id, start, end, reason],
      )
    ).rows[0];
  });
}
