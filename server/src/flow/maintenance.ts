import { pool } from '../db/pool.js';
import { cleanup } from './booking.js';
import { exportOutbox } from './outbox.js';
import { maintainSeatPools } from './seatPools.js';
let running: Promise<void> | undefined;
async function run() {
  // A dedicated session holds leadership while helpers borrow other pool connections.
  // With transaction-pooling DB URLs use MAINTENANCE_ENABLED=false and one direct-URL worker.
  const db = await pool.connect();
  let locked = false;
  try {
    locked = (await db.query('SELECT pg_try_advisory_lock(73021,2) AS locked')).rows[0].locked;
    if (!locked) return;
    await cleanup();
    await maintainSeatPools();
    await exportOutbox();
    await db.query('DELETE FROM request_limits WHERE resets_at<now()');
    await db.query("DELETE FROM account_actions WHERE expires_at<now()-interval '7 days'");
  } finally {
    // A failed unlock must not leak a connection or return a locked session to the pool.
    let releaseError: Error | undefined;
    try {
      if (locked) await db.query('SELECT pg_advisory_unlock(73021,2)');
    } catch (error) {
      releaseError = error instanceof Error ? error : new Error('Maintenance unlock failed');
      throw error;
    } finally {
      db.release(releaseError);
    }
  }
}
export function maintenance() {
  if (!running)
    running = run().finally(() => {
      running = undefined;
    });
  return running;
}
export function startMaintenance() {
  const tick = () =>
    void maintenance().catch((error: unknown) => {
      // Log diagnostic fields, never the full connection configuration or credentials.
      const failure = error as { code?: string; message?: string } | null;
      console.error('Maintenance failed; it will retry on the next tick.', {
        code: failure?.code,
        message: failure?.message ?? 'Unknown maintenance error',
      });
    });
  tick();
  const timer = setInterval(tick, 15000);
  return async () => {
    clearInterval(timer);
    await running;
  };
}
