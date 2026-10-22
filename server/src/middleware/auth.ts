import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config, production } from '../config.js';
import { pool } from '../db/pool.js';

export interface AdminClaims {
  sub: number;
  email: string;
  name: string;
  kind: 'admin';
  sessionVersion: number;
}

export interface CustomerClaims {
  sub: number;
  email: string;
  name: string;
  kind: 'customer';
  sessionVersion: number;
}

declare global {
  namespace Express {
    interface Request {
      admin?: AdminClaims;
      customer?: CustomerClaims;
    }
  }
}

export function signAdminToken(
  claims: Omit<AdminClaims, 'kind' | 'sessionVersion'> & { sessionVersion?: number },
) {
  return jwt.sign(
    { ...claims, sessionVersion: claims.sessionVersion ?? 0, kind: 'admin' },
    config.jwtSecret,
    { expiresIn: '7d' },
  );
}

export function signCustomerToken(
  claims: Omit<CustomerClaims, 'kind' | 'sessionVersion'> & { sessionVersion?: number },
) {
  return jwt.sign(
    { ...claims, sessionVersion: claims.sessionVersion ?? 0, kind: 'customer' },
    config.jwtSecret,
    { expiresIn: '30d' },
  );
}

/** Verify the Bearer token, if any. Returns the payload or null. */
function verifyBearer(req: Request): any | null {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

// Both token kinds share one signing secret, so every guard must check `kind` —
// otherwise a customer token would open the admin API.
async function validSession(table: 'users' | 'customers', payload: any) {
  if (!Number.isInteger(payload.sub) || !Number.isInteger(payload.sessionVersion)) return false;
  const {
    rows: [account],
  } = await pool.query(`SELECT session_version,email_verified_at FROM ${table} WHERE id=$1`, [
    payload.sub,
  ]);
  return (
    !!account &&
    account.session_version === payload.sessionVersion &&
    (!production || !!account.email_verified_at)
  );
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const payload = verifyBearer(req);
  if (!payload || payload.kind !== 'admin') {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'SESSION_INVALID' });
  }
  void validSession('users', payload)
    .then((valid) => {
      if (!valid)
        return res.status(401).json({ error: 'Invalid or expired token', code: 'SESSION_INVALID' });
      req.admin = payload as AdminClaims;
      next();
    })
    .catch(next);
}

export function optionalAdmin(req: Request, _res: Response, next: NextFunction) {
  const payload = verifyBearer(req);
  if (!payload || payload.kind !== 'admin') return next();
  void validSession('users', payload)
    .then((valid) => {
      if (valid) req.admin = payload as AdminClaims;
      next();
    })
    .catch(next);
}

export function requireCustomer(req: Request, res: Response, next: NextFunction) {
  const payload = verifyBearer(req);
  if (!payload || payload.kind !== 'customer') {
    return res.status(401).json({ error: 'Sign in to continue', code: 'SESSION_INVALID' });
  }
  void validSession('customers', payload)
    .then((valid) => {
      if (!valid)
        return res.status(401).json({ error: 'Sign in to continue', code: 'SESSION_INVALID' });
      req.customer = payload as CustomerClaims;
      next();
    })
    .catch(next);
}
