import { z } from 'zod';
import { pool } from '../db/pool.js';
import { computeSlots } from '../services/slots.js';
import { dateSchema, timeSchema, addDays, localTime, minuteOfDay } from './time.js';
export const preferencesSchema = z
  .object({
    resourceId: z.coerce.number().int().positive(),
    serviceId: z.coerce.number().int().positive(),
    date: dateSchema,
    time: timeSchema,
    flexDays: z.coerce.number().int().min(0).max(3).default(1),
    allowOtherResources: z.boolean().default(true),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export const weights = {
  timeCloseness: 0.45,
  dateCloseness: 0.25,
  preferredResourceMatch: 0.15,
  locationMatch: 0.1,
  lowerDemandBonus: 0.05,
};
export function scoreCandidate(
  timeDelta: number,
  dayDelta: number,
  sameResource: boolean,
  sameLocation: boolean,
  demand: number,
) {
  const components = {
    timeCloseness: Math.max(0, 1 - Math.abs(timeDelta) / 720),
    dateCloseness: Math.max(0, 1 - Math.abs(dayDelta) / 4),
    preferredResourceMatch: sameResource ? 1 : 0,
    locationMatch: sameLocation ? 1 : 0,
    lowerDemandBonus: 1 - Math.min(1, Math.max(0, demand) / 8),
  };
  const score = Object.entries(weights).reduce(
    (total, [key, weight]) => total + components[key as keyof typeof components] * weight,
    0,
  );
  return { score: Math.round(score * 1000) / 1000, components };
}
export async function recommend(input: Preferences) {
  const {
    rows: [base],
  } = await pool.query(
    `SELECT p.*,o.timezone,s.duration_min,s.name AS service_name FROM providers p JOIN organizations o ON o.id=p.organization_id JOIN resource_services rs ON rs.resource_id=p.id JOIN services s ON s.id=rs.service_id WHERE p.id=$1 AND s.id=$2 AND p.active AND s.active`,
    [input.resourceId, input.serviceId],
  );
  if (!base) throw Object.assign(new Error('Resource or service not found'), { status: 404 });
  // Same type, duration and service label only: a lab session cannot become a clinical appointment.
  const { rows: resources } = await pool.query(
    `SELECT p.*,s.id AS service_id,s.name AS service_name,l.name AS location_name FROM providers p JOIN locations l ON l.id=p.location_id JOIN resource_services rs ON rs.resource_id=p.id JOIN services s ON s.id=rs.service_id WHERE p.active AND s.active AND p.organization_id=$1 AND p.business_type=$2 AND s.duration_min=$3 AND s.name=$4 AND ($5::boolean OR p.id=$6) ORDER BY p.id LIMIT 12`,
    [
      base.organization_id,
      base.business_type,
      base.duration_min,
      base.service_name,
      input.allowOtherResources,
      base.id,
    ],
  );
  const candidates = [];
  for (const resource of resources) {
    for (let day = 0; day <= input.flexDays; day++) {
      const date = addDays(input.date, day);
      const { slots } = await computeSlots(pool, resource.id, resource.service_id, date);
      const {
        rows: [load],
      } = await pool.query(
        `SELECT count(*)::int AS count FROM bookings WHERE provider_id=$1 AND status='confirmed' AND (starts_at AT TIME ZONE $3)::date=$2::date`,
        [resource.id, date, base.timezone],
      );
      for (const slot of slots) {
        const time = localTime(slot.start, base.timezone),
          delta = minuteOfDay(time) - minuteOfDay(input.time);
        const sameResource = resource.id === base.id,
          sameLocation = resource.location_id === base.location_id;
        const ranked = scoreCandidate(delta, day, sameResource, sameLocation, load.count);
        const reason = [
          day === 0 ? 'Same day' : `${day} day${day === 1 ? '' : 's'} later`,
          delta === 0
            ? 'your preferred time'
            : `${Math.abs(delta)} min ${delta > 0 ? 'later' : 'earlier'}`,
          sameResource ? 'your chosen resource' : resource.name,
          sameLocation ? 'same location' : resource.location_name,
        ].join(' · ');
        candidates.push({
          ...slot,
          ...ranked,
          resourceId: resource.id,
          serviceId: resource.service_id,
          resourceName: resource.name,
          serviceName: resource.service_name,
          location: resource.location_name,
          date,
          time,
          reason,
          timezone: base.timezone,
        });
      }
    }
  }
  candidates.sort(
    (a, b) => b.score - a.score || a.start.localeCompare(b.start) || a.resourceId - b.resourceId,
  );
  return {
    candidates: candidates.slice(0, 5),
    verifiedAt: new Date().toISOString(),
    weights,
    totalCandidates: candidates.length,
  };
}
