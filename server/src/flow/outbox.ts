import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db/pool.js';
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
/** Idempotent local delivery: one filename per notification; retries overwrite the same file. */
export async function exportOutbox() {
  const { rows } = await pool.query(
    'SELECT * FROM flow_notifications WHERE exported_at IS NULL ORDER BY id LIMIT 100',
  );
  if (!rows.length) return;
  const directory = path.resolve('outbox');
  await mkdir(directory, { recursive: true });
  for (const n of rows) {
    await writeFile(
      path.join(directory, `bookflow-${n.id}.html`),
      `<!doctype html><html><head><meta charset="utf-8"><title>BookFlow notification</title></head><body style="font:16px system-ui;max-width:600px;margin:60px auto"><p>BookFlow / Notification</p><h1>${escape(n.title)}</h1><p>${escape(n.message)}</p><p>Open My bookings in BookFlow to manage this reservation.</p></body></html>`,
    );
    await pool.query('UPDATE flow_notifications SET exported_at=now() WHERE id=$1', [n.id]);
  }
}
