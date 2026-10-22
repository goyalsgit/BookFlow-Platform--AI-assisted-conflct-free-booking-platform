import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { consumeLimit } from './limits.js';
import { fail } from '../middleware/errors.js';
import { transaction } from '../db/transaction.js';

export type AccountKind = 'customer' | 'admin';
type Purpose = 'verify' | 'reset';
const table = (kind: AccountKind) => (kind === 'admin' ? 'users' : 'customers');
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

async function deliver(to: string, purpose: Purpose, token: string) {
  const destination = new URL(
    purpose === 'reset' ? '/account/reset' : '/account/verify',
    config.clientOrigin,
  );
  destination.searchParams.set('token', token);
  const subject =
    purpose === 'reset' ? 'Reset your BookFlow password' : 'Verify your BookFlow email';
  const html = `<p>${subject}</p><p><a href="${destination.toString()}">Continue to BookFlow</a></p><p>This link expires ${purpose === 'reset' ? 'in 30 minutes' : 'in 24 hours'}. If you did not request it, ignore this message.</p>`;
  if (config.mail.host) {
    const transport = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      connectionTimeout: 10000,
      socketTimeout: 15000,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    });
    await transport.sendMail({ from: config.mail.from, to, subject, html });
  } else {
    const directory = path.resolve('outbox');
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, `account-${Date.now()}-${randomBytes(6).toString('hex')}.html`),
      html,
      { mode: 0o600 },
    );
  }
}

export async function issueAction(
  kind: AccountKind,
  accountId: number,
  email: string,
  purpose: Purpose,
) {
  const token = randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO account_actions(account_kind,account_id,purpose,token_hash,expires_at)
     VALUES($1,$2,$3,$4,now()+make_interval(secs=>$5))`,
    [kind, accountId, purpose, digest(token), purpose === 'reset' ? 1800 : 86400],
  );
  await deliver(email, purpose, token);
  return token;
}

export async function requestAction(kind: AccountKind, email: string, purpose: Purpose) {
  const normalized = email.toLowerCase();
  const limit = await consumeLimit(`account:${purpose}:${kind}:${normalized}`, 3, 3600);
  if (!limit.allowed) return;
  const {
    rows: [account],
  } = await pool.query(`SELECT id,email,email_verified_at FROM ${table(kind)} WHERE email=$1`, [
    normalized,
  ]);
  if (!account || (purpose === 'verify' && account.email_verified_at)) return;
  try {
    await issueAction(kind, account.id, account.email, purpose);
  } catch (error) {
    console.error(`Could not deliver ${purpose} account message`, error);
  }
}

export async function redeemAction(token: string, purpose: Purpose, newPassword?: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return fail(400, 'Invalid or expired link');
  const hash = purpose === 'reset' ? await bcrypt.hash(newPassword!, 12) : null;
  return transaction(async (db) => {
    const {
      rows: [action],
    } = await db.query(
      `SELECT * FROM account_actions WHERE token_hash=$1 AND purpose=$2 FOR UPDATE`,
      [digest(token), purpose],
    );
    if (!action || action.used_at || new Date(action.expires_at) <= new Date())
      return fail(400, 'Invalid or expired link');
    const accountTable = table(action.account_kind);
    let updated;
    if (purpose === 'reset') {
      updated = await db.query(
        `UPDATE ${accountTable} SET password_hash=$2,session_version=session_version+1,email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1`,
        [action.account_id, hash],
      );
    } else {
      updated = await db.query(`UPDATE ${accountTable} SET email_verified_at=now() WHERE id=$1`, [
        action.account_id,
      ]);
    }
    if (!updated.rowCount) return fail(400, 'Invalid or expired link');
    await db.query(
      `UPDATE account_actions SET used_at=now() WHERE account_kind=$1 AND account_id=$2 AND purpose=$3 AND used_at IS NULL`,
      [action.account_kind, action.account_id, purpose],
    );
  });
}
