import type pg from 'pg';
import { dateSchema } from '../flow/time.js';
import { fail } from '../middleware/errors.js';
export interface Slot {
  start: string;
  end: string;
}
export interface Interval {
  start: Date;
  end: Date;
}
/** PostgreSQL expands local schedules in the organization's IANA timezone.
 * Walking UTC instants preserves both occurrences of a repeated DST hour and skips nonexistent times. */
export async function computeSlots(
  db: pg.Pool | pg.PoolClient,
  providerId: number,
  serviceId: number,
  date: string,
  excludeBookingId?: number,
): Promise<{ slots: Slot[]; provider: any; service: any }> {
  dateSchema.parse(date);
  // Keep the complete query result, then read its first row explicitly.
  const providerResult = await db.query(
    `SELECT p.*, o.timezone
     FROM providers p
     JOIN organizations o ON o.id = p.organization_id
     WHERE p.id = $1 AND p.active`,
    [providerId],
  );
  const provider = providerResult.rows[0];
  if (!provider) fail(404, 'Resource not found');
  const serviceResult = await db.query(
    `SELECT s.*
     FROM services s
     JOIN resource_services rs ON rs.service_id = s.id
     WHERE rs.resource_id = $1 AND s.id = $2 AND s.active`,
    [providerId, serviceId],
  );
  const service = serviceResult.rows[0];
  if (!service) fail(404, 'Service not found');
  const availabilityResult = await db.query(
    `
    -- 1. Convert this weekday's opening hours into timestamp windows.
    WITH windows AS (
      SELECT
        ($3::date + start_time) AT TIME ZONE $4 AS opening,
        ($3::date + end_time) AT TIME ZONE $4 AS closing
      FROM schedules
      WHERE provider_id = $1
        AND weekday = extract(dow FROM $3::date)
    ),
    -- 2. Generate candidate sessions, including preparation and cleanup time.
    candidates AS (
      SELECT
        t AS starts_at,
        t + make_interval(mins => $5) AS ends_at,
        t - make_interval(mins => $6) AS blocked_start,
        t + make_interval(mins => $5 + $7) AS blocked_end,
        opening,
        closing
      FROM windows
      CROSS JOIN LATERAL generate_series(
        opening, closing, make_interval(mins => $8)
      ) t
    )
    SELECT DISTINCT starts_at, ends_at
    FROM candidates c
    WHERE $2::int > 0
      -- 3. Keep the complete blocked range inside opening hours.
      AND blocked_start >= opening
      AND blocked_end <= closing
      AND starts_at >= now() + make_interval(mins => $9)
      AND starts_at <= now() + make_interval(days => $10)
      -- 4. Remove candidates that overlap recurring breaks or dated time off.
      AND NOT EXISTS (
        SELECT 1 FROM breaks b
        WHERE b.provider_id = $1
          AND b.weekday = extract(dow FROM $3::date)
          AND c.blocked_start < (($3::date + b.end_time) AT TIME ZONE $4)
          AND c.blocked_end > (($3::date + b.start_time) AT TIME ZONE $4)
      )
      AND NOT EXISTS (
        SELECT 1 FROM time_off t
        WHERE t.provider_id = $1
          AND c.blocked_start < t.ends_at
          AND c.blocked_end > t.starts_at
      )
      -- 5. Remove occupied times; exclude the current booking when rescheduling.
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.provider_id = $1
          AND b.status IN ('held', 'pending_payment', 'confirmed', 'completed')
          AND (b.status NOT IN ('held', 'pending_payment') OR b.expires_at > now())
          AND ($11::int IS NULL OR b.id <> $11)
          AND c.blocked_start < b.blocked_end
          AND c.blocked_end > b.blocked_start
      )
      -- 6. Published seat pools also reserve the resource's time.
      AND NOT EXISTS (
        SELECT 1 FROM seat_pools sp
        WHERE sp.resource_id = $1
          AND sp.status = 'open'
          AND c.blocked_start < sp.blocked_end
          AND c.blocked_end > sp.blocked_start
      )
    ORDER BY starts_at`,
    [
      providerId,
      serviceId,
      date,
      provider.timezone,
      service.duration_min,
      service.buffer_before_min,
      service.buffer_min,
      provider.slot_step_min,
      provider.min_lead_min,
      provider.booking_horizon_days,
      excludeBookingId ?? null,
    ],
  );
  // Unlike the resource/service lookup, availability can contain many rows.
  const availableRows = availabilityResult.rows;
  const slots = availableRows.map((row) => ({
    start: row.starts_at.toISOString(),
    end: row.ends_at.toISOString(),
  }));

  return { provider, service, slots };
}
