import { z } from 'zod';
import { pool } from '../db/pool.js';
import { transaction, lockResource, fail } from './booking.js';
import { timeSchema } from './time.js';
const validTimezone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};
export const businessSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    timezone: z.string().refine(validTimezone, 'Use a valid IANA timezone, such as Asia/Kolkata'),
    cancellationCutoffMinutes: z.number().int().min(0).max(10080),
  })
  .strict();
export const scheduleSchema = z
  .array(
    z
      .object({ weekday: z.number().int().min(0).max(6), start: timeSchema, end: timeSchema })
      .strict()
      .refine((v) => v.end > v.start, 'Closing time must follow opening time'),
  )
  .max(28)
  .refine(
    (windows) =>
      windows.every((a, i) =>
        windows.every(
          (b, j) => i === j || a.weekday !== b.weekday || a.start >= b.end || a.end <= b.start,
        ),
      ),
    'Working windows must not overlap',
  );
export const resourceSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    type: z
      .string()
      .trim()
      .min(2)
      .max(50)
      .regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, numbers and underscores'),
    description: z.string().max(1000).default(''),
    locationId: z.number().int().positive(),
    serviceName: z.string().trim().min(2).max(100),
    durationMinutes: z.number().int().min(5).max(480),
    bufferBefore: z.number().int().min(0).max(120),
    bufferAfter: z.number().int().min(0).max(120),
    priceCents: z.number().int().min(0).max(100000000),
    slotStep: z.number().int().min(5).max(120).default(15),
    schedule: scheduleSchema,
  })
  .strict();
export async function settings(org: number) {
  const {
    rows: [organization],
  } = await pool.query('SELECT * FROM organizations WHERE id=$1', [org]);
  const { rows: locations } = await pool.query(
    'SELECT * FROM locations WHERE organization_id=$1 ORDER BY id',
    [org],
  );
  const { rows: resources } = await pool.query(
    `SELECT p.*,l.name AS location_name,COALESCE((SELECT json_agg(json_build_object('weekday',weekday,'start',to_char(start_time,'HH24:MI'),'end',to_char(end_time,'HH24:MI')) ORDER BY weekday,start_time) FROM schedules WHERE provider_id=p.id),'[]') AS schedule FROM providers p JOIN locations l ON l.id=p.location_id WHERE p.organization_id=$1 ORDER BY p.id`,
    [org],
  );
  for(const resource of resources){
    resource.services=(await pool.query('SELECT * FROM services WHERE provider_id=$1 ORDER BY id',[resource.id])).rows;
    resource.timeOff=(await pool.query('SELECT * FROM time_off WHERE provider_id=$1 AND ends_at>now() ORDER BY starts_at',[resource.id])).rows;
  }
  return { organization, locations, resources };
}
export async function updateBusiness(
  org: number,
  actor: number,
  input: z.infer<typeof businessSchema>,
) {
  return transaction(async (db) => {
    const {
      rows: [old],
    } = await db.query('SELECT * FROM organizations WHERE id=$1 FOR UPDATE', [org]);
    if (old.timezone !== input.timezone) {
      const active = await db.query(
        `SELECT 1 FROM bookings b JOIN providers p ON p.id=b.provider_id WHERE p.organization_id=$1 AND b.status IN('held','confirmed') AND b.ends_at>now() LIMIT 1`,
        [org],
      );
      if (active.rowCount)
        return fail(409, 'Resolve future reservations before changing the business timezone.');
    }
    const {
      rows: [updated],
    } = await db.query(
      'UPDATE organizations SET name=$2,timezone=$3,cancellation_cutoff_min=$4 WHERE id=$1 RETURNING *',
      [org, input.name, input.timezone, input.cancellationCutoffMinutes],
    );
    await db.query(
      `INSERT INTO workspace_events(organization_id,actor_id,action,detail) VALUES($1,$2,'business_updated',$3)`,
      [org, actor, JSON.stringify({ before: old, after: updated })],
    );
    return updated;
  });
}
export async function createResource(
  org: number,
  actor: number,
  input: z.infer<typeof resourceSchema>,
) {
  return transaction(async (db) => {
    if (
      !(
        await db.query('SELECT 1 FROM locations WHERE id=$1 AND organization_id=$2', [
          input.locationId,
          org,
        ])
      ).rowCount
    )
      return fail(404, 'Location not found');
    const {
      rows: [resource],
    } = await db.query(
      `INSERT INTO providers(organization_id,location_id,name,business_type,title,bio,slot_step_min,min_lead_min,reschedule_cutoff_min) VALUES($1,$2,$3,$4,$4,$5,$6,30,60) RETURNING *`,
      [org, input.locationId, input.name, input.type, input.description, input.slotStep],
    );
    await db.query(
      `INSERT INTO services(provider_id,name,duration_min,buffer_before_min,buffer_min,price_cents) VALUES($1,$2,$3,$4,$5,$6)`,
      [
        resource.id,
        input.serviceName,
        input.durationMinutes,
        input.bufferBefore,
        input.bufferAfter,
        input.priceCents,
      ],
    );
    for (const w of input.schedule)
      await db.query(
        'INSERT INTO schedules(provider_id,weekday,start_time,end_time) VALUES($1,$2,$3,$4)',
        [resource.id, w.weekday, w.start, w.end],
      );
    await db.query(
      `INSERT INTO workspace_events(organization_id,actor_id,action,resource_id,detail) VALUES($1,$2,'resource_created',$3,$4)`,
      [org, actor, resource.id, JSON.stringify(input)],
    );
    return resource;
  });
}
export async function replaceSchedule(
  org: number,
  actor: number,
  resourceId: number,
  windows: z.infer<typeof scheduleSchema>,
) {
  return transaction(async (db) => {
    await lockResource(db, resourceId);
    const {
      rows: [r],
    } = await db.query(
      `SELECT p.*,o.timezone FROM providers p JOIN organizations o ON o.id=p.organization_id WHERE p.id=$1 AND p.organization_id=$2`,
      [resourceId, org],
    );
    if (!r) return fail(404, 'Resource not found');
    const { rows: active } = await db.query(
      `SELECT code,extract(dow FROM blocked_start AT TIME ZONE $2)::int AS weekday,to_char(blocked_start AT TIME ZONE $2,'HH24:MI') AS start,to_char(blocked_end AT TIME ZONE $2,'HH24:MI') AS end,(blocked_start AT TIME ZONE $2)::date=(blocked_end AT TIME ZONE $2)::date AS same_day FROM bookings WHERE provider_id=$1 AND status IN('held','confirmed') AND ends_at>now() AND (status<>'held' OR expires_at>now())`,
      [resourceId, r.timezone],
    );
    if (
      active.some(
        (b) =>
          !b.same_day ||
          !windows.some((w) => w.weekday === b.weekday && w.start <= b.start && w.end >= b.end),
      )
    )
      return fail(
        409,
        'The new schedule would exclude an existing reservation. Resolve it before changing hours.',
      );
    const before = (await db.query('SELECT * FROM schedules WHERE provider_id=$1', [resourceId]))
      .rows;
    await db.query('DELETE FROM schedules WHERE provider_id=$1', [resourceId]);
    for (const w of windows)
      await db.query(
        'INSERT INTO schedules(provider_id,weekday,start_time,end_time) VALUES($1,$2,$3,$4)',
        [resourceId, w.weekday, w.start, w.end],
      );
    await db.query(
      `INSERT INTO workspace_events(organization_id,actor_id,action,resource_id,detail) VALUES($1,$2,'schedule_updated',$3,$4)`,
      [org, actor, resourceId, JSON.stringify({ before, after: windows })],
    );
    return { ok: true };
  });
}

export const serviceSchema=z.object({
 name:z.string().trim().min(2).max(100),durationMinutes:z.number().int().min(5).max(480),
 bufferBefore:z.number().int().min(0).max(120),bufferAfter:z.number().int().min(0).max(120),
 priceCents:z.number().int().min(0).max(100000000),active:z.boolean().default(true),
}).strict();
export async function saveService(org:number,actor:number,resourceId:number,input:z.infer<typeof serviceSchema>,serviceId?:number){
 return transaction(async db=>{
  await lockResource(db,resourceId);
  if(!(await db.query('SELECT 1 FROM providers WHERE id=$1 AND organization_id=$2',[resourceId,org])).rowCount)return fail(404,'Resource not found');
  let result;
  if(serviceId){
   const {rows:[old]}=await db.query('SELECT * FROM services WHERE id=$1 AND provider_id=$2 FOR UPDATE',[serviceId,resourceId]);
   if(!old)return fail(404,'Service not found');
   if(old.duration_min!==input.durationMinutes||old.buffer_before_min!==input.bufferBefore||old.buffer_min!==input.bufferAfter||!input.active){
    const busy=await db.query(`SELECT 1 FROM bookings WHERE service_id=$1 AND status IN('held','confirmed') AND ends_at>now() AND (status<>'held' OR expires_at>now())
    UNION ALL SELECT 1 FROM allocation_requests WHERE service_id=$1 AND status IN('waiting','offered') LIMIT 1`,[serviceId]);
    if(busy.rowCount)return fail(409,'Resolve active reservations and waitlist requests before changing session timing or pausing this service.');
   }
   result=await db.query('UPDATE services SET name=$3,duration_min=$4,buffer_before_min=$5,buffer_min=$6,price_cents=$7,active=$8 WHERE id=$1 AND provider_id=$2 RETURNING *',[serviceId,resourceId,input.name,input.durationMinutes,input.bufferBefore,input.bufferAfter,input.priceCents,input.active]);
  }else result=await db.query('INSERT INTO services(provider_id,name,duration_min,buffer_before_min,buffer_min,price_cents,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[resourceId,input.name,input.durationMinutes,input.bufferBefore,input.bufferAfter,input.priceCents,input.active]);
  await db.query(`INSERT INTO workspace_events(organization_id,actor_id,action,resource_id,detail) VALUES($1,$2,$3,$4,$5)`,[org,actor,serviceId?'service_updated':'service_created',resourceId,JSON.stringify({serviceId:result.rows[0].id,...input})]);
  return result.rows[0];
 });
}
export const resourceDetailsSchema=z.object({name:z.string().trim().min(2).max(100),type:z.string().regex(/^[a-z][a-z0-9_]*$/).min(2).max(50),description:z.string().max(1000),locationId:z.number().int().positive()}).strict();
export async function editResource(org:number,actor:number,id:number,input:z.infer<typeof resourceDetailsSchema>){
 return transaction(async db=>{await lockResource(db,id);
  if(!(await db.query('SELECT 1 FROM locations WHERE id=$1 AND organization_id=$2',[input.locationId,org])).rowCount)return fail(404,'Location not found');
  const {rows:[r]}=await db.query('UPDATE providers SET name=$3,business_type=$4,bio=$5,location_id=$6 WHERE id=$1 AND organization_id=$2 RETURNING *',[id,org,input.name,input.type,input.description,input.locationId]);
  if(!r)return fail(404,'Resource not found');
  await db.query(`INSERT INTO workspace_events(organization_id,actor_id,action,resource_id,detail) VALUES($1,$2,'resource_updated',$3,$4)`,[org,actor,id,JSON.stringify(input)]);return r;
 });
}
export async function removeTimeOff(org:number,resourceId:number,timeOffId:number){
 return transaction(async db=>{await lockResource(db,resourceId);
  const result=await db.query('DELETE FROM time_off t USING providers p WHERE t.provider_id=p.id AND p.organization_id=$1 AND p.id=$2 AND t.id=$3 RETURNING t.id',[org,resourceId,timeOffId]);
  if(!result.rowCount)return fail(404,'Time off not found');return {ok:true};
 });
}
