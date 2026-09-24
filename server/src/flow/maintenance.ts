import {pool} from '../db/pool.js';
import {cleanup} from './booking.js';
import {exportOutbox} from './outbox.js';
let running: Promise<void> | undefined;
async function run() {
 // A dedicated session holds leadership while helpers borrow other pool connections.
 // With transaction-pooling DB URLs use MAINTENANCE_ENABLED=false and one direct-URL worker.
 const db=await pool.connect();let locked=false;
 try {
  locked=(await db.query('SELECT pg_try_advisory_lock(73021,2) AS locked')).rows[0].locked;
  if(!locked)return;
  await cleanup();await exportOutbox();
  await db.query('DELETE FROM request_limits WHERE resets_at<now()');
 } finally {if(locked)await db.query('SELECT pg_advisory_unlock(73021,2)');db.release();}
}
export function maintenance(){
 if(!running)running=run().finally(()=>{running=undefined;});
 return running;
}
export function startMaintenance(){
 const tick=()=>void maintenance().catch(()=>console.error('Maintenance failed; it will retry on the next tick.'));
 tick();const timer=setInterval(tick,15000);
 return async()=>{clearInterval(timer);await running;};
}
