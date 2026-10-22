import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
/** Idempotent local delivery: one filename per notification; retries overwrite the same file. */
export async function exportOutbox() {
  if (config.notificationMode === 'inbox') return;
  if (config.notificationMode === 'smtp') return sendEmailNotifications();
  if (config.notificationMode !== 'file')
    throw new Error('NOTIFICATION_MODE must be inbox, file, or smtp');
  const { rows } = await pool.query(
    'SELECT * FROM flow_notifications WHERE exported_at IS NULL ORDER BY id LIMIT 100',
  );
  if (!rows.length) return;
  const directory = path.resolve('outbox');
  await mkdir(directory, { recursive: true });
  for (const n of rows) {
    await writeFile(
      path.join(directory, `bookflow-${n.id}.html`),
      `<!doctype html><html><head><meta charset="utf-8"><title>BookFlow notification</title></head><body style="font:16px system-ui;max-width:600px;margin:60px auto"><p>BookFlow / Notification</p><h1>${escape(n.title)}</h1><p>${escape(n.message)}</p><p>Open ${n.title.toLowerCase().includes('seat') ? 'Seat pools' : 'My bookings'} in BookFlow to manage this reservation.</p></body></html>`,
    );
    await pool.query('UPDATE flow_notifications SET exported_at=now() WHERE id=$1', [n.id]);
  }
}

async function sendEmailNotifications() {
  if (!config.mail.host) throw new Error('SMTP_HOST is required for NOTIFICATION_MODE=smtp');
  const transport = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.port === 465,
    connectionTimeout: 10000,
    socketTimeout: 15000,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
  });
  const { rows } = await pool.query(`
    SELECT n.*,c.email,b.status AS booking_status,b.expires_at AS booking_expires_at
    FROM flow_notifications n JOIN customers c ON c.id=n.customer_id
    LEFT JOIN bookings b ON b.id=n.booking_id
    WHERE n.email_sent_at IS NULL AND n.email_next_at<=now() AND n.email_attempts<5
    ORDER BY n.id LIMIT 20
  `);
  for (const notice of rows) {
    if (
      notice.title === 'A slot is held for you' &&
      (notice.booking_status !== 'held' || new Date(notice.booking_expires_at) <= new Date())
    ) {
      await pool.query(
        'UPDATE flow_notifications SET email_sent_at=now(),email_last_error=$2 WHERE id=$1',
        [notice.id, 'Offer expired before email delivery'],
      );
      continue;
    }
    try {
      await transport.sendMail({
        from: config.mail.from,
        to: notice.email,
        subject: `BookFlow: ${notice.title}`,
        html: `<h1>${escape(notice.title)}</h1><p>${escape(notice.message)}</p><p>Open ${notice.title.toLowerCase().includes('seat') ? 'Seat pools' : 'My bookings'} in BookFlow to review this reservation.</p>`,
      });
      await pool.query(
        'UPDATE flow_notifications SET email_sent_at=now(),email_last_error=NULL WHERE id=$1',
        [notice.id],
      );
    } catch (error: any) {
      await pool.query(
        `UPDATE flow_notifications SET email_attempts=email_attempts+1,
        email_next_at=now()+interval '1 minute'*(power(2,email_attempts)::int),
        email_last_error=$2 WHERE id=$1`,
        [notice.id, String(error.message ?? error).slice(0, 500)],
      );
    }
  }
}
