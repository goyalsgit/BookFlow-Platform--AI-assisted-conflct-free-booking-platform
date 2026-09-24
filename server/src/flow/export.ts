import type {Response} from 'express';
import {pool} from '../db/pool.js';
export const csvCell=(value:unknown)=>'"'+String(value??'').replace(/^(?=[\s]*[=+@-])/,"'").replaceAll('"','""')+'"';
export async function exportBookings(org:number,res:Response){
 const db=await pool.connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await db.query(`DECLARE booking_export NO SCROLL CURSOR FOR SELECT b.code,p.name AS resource,c.name AS customer,b.starts_at,b.ends_at,b.status FROM bookings b JOIN providers p ON p.id=b.provider_id JOIN customers c ON c.id=b.customer_id WHERE p.organization_id=$1 ORDER BY b.id`,[org]);
  res.type('text/csv').attachment('bookflow-bookings.csv');
  res.write('\uFEFF'+['Reference','Resource','Customer','Start UTC','End UTC','Status'].map(csvCell).join(',')+'\r\n');
  while(!res.destroyed){
   const {rows}=await db.query('FETCH FORWARD 500 FROM booking_export');if(!rows.length)break;
   const chunk=rows.map(b=>[b.code,b.resource,b.customer,new Date(b.starts_at).toISOString(),new Date(b.ends_at).toISOString(),b.status].map(csvCell).join(',')).join('\r\n')+'\r\n';
   if(!res.write(chunk))await new Promise<void>(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});
  }
  await db.query('COMMIT');res.end();
 }catch(error){await db.query('ROLLBACK');if(res.headersSent)res.destroy();else throw error;}
 finally{db.release();}
}
