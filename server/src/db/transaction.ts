import type pg from 'pg';
import { pool } from './pool.js';
import { fail } from '../middleware/errors.js';

/** Run related writes on one connection and commit or roll them back together. */
export async function transaction<T>(work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error: any) {
    await db.query('ROLLBACK');
    if (error.code === '23P01')
      fail(409, 'SLOT_CONFLICT: That slot was just taken. Choose another option.');
    if (error.code === '23505')
      fail(409, 'This request already exists. Refresh to see its status.');
    throw error;
  } finally {
    db.release();
  }
}
