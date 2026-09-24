import bcrypt from 'bcryptjs';
import {pool} from './pool.js';
import {computeSlots} from '../services/slots.js';
import {addDays,localDate} from '../flow/time.js';
if(process.env.NODE_ENV==='production' && process.env.ALLOW_DEMO_SEED!=='true')throw new Error('Demo seeding is disabled in production. Use db:bootstrap or explicitly set ALLOW_DEMO_SEED=true for a public demo.');
const db=await pool.connect();
try{
 await db.query('BEGIN');
 const existing=await db.query('SELECT 1 FROM providers LIMIT 1');
 if(existing.rowCount)throw new Error('Seed requires an empty business database. Existing data was preserved.');
 const adminHash=await bcrypt.hash('admin123',12), customerHash=await bcrypt.hash('customer123',12);
 await db.query(`INSERT INTO users(name,email,password_hash,organization_id) VALUES('Campus administrator','admin@bookflow.local',$1,1)`,[adminHash]);
 const {rows:[customer]}=await db.query(`INSERT INTO customers(name,email,password_hash) VALUES('Alex Morgan','customer@bookflow.local',$1) RETURNING id`,[customerHash]);
 const resources=[
 {name:'Badminton Court A',type:'sports_court',title:'Indoor · Tournament standard',bio:'A bright, indoor court with professional flooring. Rackets and shuttlecocks available at reception.',emoji:'🏸',color:'#0e8c6c',location:1,services:[['Court session',60,0,0,40000],['Extended court session',90,0,0,55000]]},
 {name:'Badminton Court B',type:'sports_court',title:'Indoor · Training & recreation',bio:'An indoor court for a quick match or a longer practice session. Same campus, more possibilities.',emoji:'🏸',color:'#0e8c6c',location:1,services:[['Court session',60,0,0,40000],['Extended court session',90,0,0,55000]]},
 {name:'Dr. Asha Rao',type:'clinician',title:'Campus clinic · General consultation',bio:'Book a private consultation at the campus health centre. Preparation and cleanup time are reserved automatically.',emoji:'✚',color:'#4378bc',location:1,services:[['Consultation',30,5,10,60000],['Follow-up',15,5,5,30000]]},
 {name:'Confocal Microscope',type:'lab_instrument',title:'Research centre · Imaging lab',bio:'A shared research instrument with protected preparation and cleanup windows between sessions.',emoji:'⌬',color:'#9664be',location:2,services:[['Imaging session',60,15,15,0],['Extended imaging',120,15,15,0]]},
 {name:'The Cedar Room',type:'meeting_room',title:'Main campus · 6 seats',bio:'A quiet space for interviews, project reviews and focused teamwork. Display and whiteboard included.',emoji:'▦',color:'#bb8745',location:1,services:[['Meeting',60,0,15,0],['Quick meeting',30,0,15,0]]},
 {name:'The Willow Room',type:'meeting_room',title:'Research centre · 6 seats',bio:'A calm meeting room close to the labs. Useful when your preferred room is already taken.',emoji:'▦',color:'#bb8745',location:2,services:[['Meeting',60,0,15,0],['Quick meeting',30,0,15,0]]}
 ];
 const ids:{resource:number;service:number}[]=[];
 for(const r of resources){
  const {rows:[p]}=await db.query(`INSERT INTO providers(business_type,name,title,bio,emoji,color,location_id,slot_step_min,min_lead_min,booking_horizon_days,reschedule_cutoff_min) VALUES($1,$2,$3,$4,$5,$6,$7,15,30,30,60) RETURNING id`,[r.type,r.name,r.title,r.bio,r.emoji,r.color,r.location]);
  let first=0;
  for(const [name,duration,before,after,price]of r.services){const {rows:[s]}=await db.query(`INSERT INTO services(provider_id,name,duration_min,buffer_before_min,buffer_min,price_cents) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[p.id,name,duration,before,after,price]);if(!first)first=s.id;}
  for(let day=0;day<7;day++){await db.query(`INSERT INTO schedules(provider_id,weekday,start_time,end_time) VALUES($1,$2,'07:00','22:00')`,[p.id,day]);if(r.type==='clinician'||r.type==='lab_instrument')await db.query(`INSERT INTO breaks(provider_id,weekday,start_time,end_time,label) VALUES($1,$2,'13:00','14:00','Lunch / maintenance')`,[p.id,day]);}
  ids.push({resource:p.id,service:first});
 }
 const tomorrow=addDays(localDate(new Date(),'Asia/Kolkata'),1);
 for(let i=0;i<ids.length;i++){
  const {slots}=await computeSlots(db,ids[i].resource,ids[i].service,tomorrow);
  const slot=slots.find(s=>new Date(s.start).toISOString().includes('12:30:00'))??slots[4];
  if(!slot)continue;
  const {rows:[b]}=await db.query(`INSERT INTO bookings(code,provider_id,service_id,customer_id,starts_at,ends_at,status) VALUES($1,$2,$3,$4,$5,$6,'confirmed') RETURNING id`,[`BF-DEMO0${i+1}`,ids[i].resource,ids[i].service,customer.id,slot.start,slot.end]);
  await db.query(`INSERT INTO booking_events(booking_id,event,actor,detail) VALUES($1,'confirmed','seed','Demo reservation; all people and bookings are fictional')`,[b.id]);
 }
 await db.query('COMMIT');console.log('BookFlow seeded: 6 resources, 4 resource types, schedules and demo bookings.');
 console.log('Customer: customer@bookflow.local / customer123');console.log('Admin: admin@bookflow.local / admin123');
}catch(error){await db.query('ROLLBACK');console.error(error);process.exitCode=1;}finally{db.release();await pool.end();}
