import { pool } from '../db/pool.js';
export async function catalog() {
  const { rows } =
    await pool.query(`SELECT p.*,l.name AS location_name,l.address AS location_address,o.name AS organization_name,o.timezone,
 COALESCE((SELECT json_agg(s ORDER BY s.duration_min) FROM services s JOIN resource_services rs ON rs.service_id=s.id WHERE rs.resource_id=p.id AND s.active),'[]') AS services,
 (SELECT json_agg(sch ORDER BY sch.weekday,sch.start_time) FROM schedules sch WHERE sch.provider_id=p.id) AS schedules
 FROM providers p JOIN locations l ON l.id=p.location_id JOIN organizations o ON o.id=p.organization_id WHERE p.active ORDER BY p.id`);
  return rows;
}
