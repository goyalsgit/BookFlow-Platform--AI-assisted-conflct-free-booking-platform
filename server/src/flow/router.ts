import { chat, chatInput } from './chat.js';
import {
  publishSchema,
  publishSeatPool,
  listSeatPools,
  mySeatRequests,
  joinSeatPool,
  allocateSeatPool,
  changeSeatRequest,
  withdrawSeatPool,
} from './seatPools.js';

import { exportBookings } from './export.js';
import { rateLimit, consumeLimit } from './limits.js';
import { suggestPlaces } from './places.js';
import { config, production } from '../config.js';
import { issueAction, requestAction, redeemAction } from './accounts.js';
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';
import { asyncHandler, fail } from '../middleware/errors.js';
import {
  requireCustomer,
  requireAdmin,
  optionalAdmin,
  signCustomerToken,
  signAdminToken,
} from '../middleware/auth.js';
import { catalog } from './catalog.js';
import { computeSlots } from '../services/slots.js';
import { preferencesSchema, recommend } from './recommendations.js';
import { hold, changeBooking, myBookings, joinQueue } from './booking.js';
import { transaction } from '../db/transaction.js';
import { dateSchema, timeSchema, wallTimeToInstant } from './time.js';
import { parseRequest } from './assistant.js';
import { operations, updateResource, finishBooking, blockTime } from './admin.js';
import {
  settings,
  updateBusiness,
  createResource,
  replaceSchedule,
  businessSchema,
  resourceSchema,
  scheduleSchema,
  saveService,
  serviceSchema,
  editResource,
  resourceDetailsSchema,
  removeTimeOff,
} from './settings.js';
export const flowRouter = Router();
const id = z.coerce.number().int().positive();
const login = z
  .object({ email: z.string().trim().email().max(200), password: z.string().min(8).max(128) })
  .strict();
flowRouter.use(rateLimit);
flowRouter.post(
  '/session',
  asyncHandler(async (req, res) => {
    const input = login.parse(req.body);
    const {
      rows: [c],
    } = await pool.query('SELECT * FROM customers WHERE email=lower($1)', [input.email]);
    if (!c?.password_hash || !(await bcrypt.compare(input.password, c.password_hash)))
      return fail(401, 'Invalid email or password');
    if (production && !c.email_verified_at) return fail(403, 'Verify your email before signing in');
    res.json({
      token: signCustomerToken({
        sub: c.id,
        email: c.email,
        name: c.name,
        sessionVersion: c.session_version,
      }),
      user: { id: c.id, name: c.name, email: c.email },
    });
  }),
);
flowRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = login.extend({ name: z.string().trim().min(2).max(100) }).parse(req.body);
    const hash = await bcrypt.hash(input.password, 12);
    try {
      const {
        rows: [c],
      } = await pool.query(
        'INSERT INTO customers(name,email,password_hash) VALUES($1,lower($2),$3) RETURNING id,name,email',
        [input.name, input.email, hash],
      );
      await issueAction('customer', c.id, c.email, 'verify').catch((error) =>
        console.error('Verification delivery failed', error),
      );
      if (production) return res.status(202).json({ verificationRequired: true });
      res
        .status(201)
        .json({ token: signCustomerToken({ sub: c.id, email: c.email, name: c.name }), user: c });
    } catch (error: any) {
      if (error.code === '23505') return fail(409, 'An account with this email already exists.');
      throw error;
    }
  }),
);
flowRouter.post(
  '/admin/session',
  asyncHandler(async (req, res) => {
    const input = login.parse(req.body);
    const {
      rows: [u],
    } = await pool.query('SELECT * FROM users WHERE email=lower($1)', [input.email]);
    if (!u || !(await bcrypt.compare(input.password, u.password_hash)))
      return fail(401, 'Invalid email or password');
    if (production && !u.email_verified_at) return fail(403, 'Verify your email before signing in');
    res.json({
      token: signAdminToken({
        sub: u.id,
        email: u.email,
        name: u.name,
        sessionVersion: u.session_version,
      }),
      user: { id: u.id, name: u.name, email: u.email },
    });
  }),
);
flowRouter.post(
  '/admin/register',
  asyncHandler(async (req, res) => {
    const input = login
      .extend({
        name: z.string().trim().min(2).max(100),
        businessName: z.string().trim().min(2).max(100),
        businessType: z.string().trim().min(2).max(80),
      })
      .parse(req.body);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const {
        rows: [organization],
      } = await db.query(
        'INSERT INTO organizations(name,slug,business_type) VALUES($1,$2,$3) RETURNING id',
        [input.businessName, `business-${randomUUID()}`, input.businessType],
      );
      await db.query('INSERT INTO locations(organization_id,name) VALUES($1,$2)', [
        organization.id,
        'Main location',
      ]);
      const {
        rows: [owner],
      } = await db.query(
        'INSERT INTO users(name,email,password_hash,organization_id) VALUES($1,lower($2),$3,$4) RETURNING id,name,email',
        [input.name, input.email, await bcrypt.hash(input.password, 12), organization.id],
      );
      await db.query('COMMIT');
      await issueAction('admin', owner.id, owner.email, 'verify').catch((error) =>
        console.error('Verification delivery failed', error),
      );
      if (production) return res.status(202).json({ verificationRequired: true });
      res.status(201).json({
        token: signAdminToken({ sub: owner.id, email: owner.email, name: owner.name }),
        user: owner,
      });
    } catch (error: any) {
      await db.query('ROLLBACK');
      if (error.code === '23505')
        return fail(409, 'A business account with this email already exists.');
      throw error;
    } finally {
      db.release();
    }
  }),
);
const actionEmail = z
  .object({ email: z.string().trim().email().max(200), kind: z.enum(['customer', 'admin']) })
  .strict();
flowRouter.post(
  '/account/reset-request',
  asyncHandler(async (req, res) => {
    const input = actionEmail.parse(req.body);
    await requestAction(input.kind, input.email, 'reset');
    res.status(202).json({ message: 'If that account exists, check its email for a link.' });
  }),
);
flowRouter.post(
  '/account/verify-request',
  asyncHandler(async (req, res) => {
    const input = actionEmail.parse(req.body);
    await requestAction(input.kind, input.email, 'verify');
    res.status(202).json({ message: 'If verification is needed, check that email for a link.' });
  }),
);
flowRouter.post(
  '/account/reset',
  asyncHandler(async (req, res) => {
    const input = z
      .object({ token: z.string(), newPassword: z.string().min(12).max(128) })
      .strict()
      .parse(req.body);
    await redeemAction(input.token, 'reset', input.newPassword);
    res.status(204).end();
  }),
);
flowRouter.post(
  '/account/verify',
  asyncHandler(async (req, res) => {
    const input = z.object({ token: z.string() }).strict().parse(req.body);
    await redeemAction(input.token, 'verify');
    res.status(204).end();
  }),
);
flowRouter.get(
  '/workspace',
  optionalAdmin,
  asyncHandler(async (req, res) => {
    const org = req.admin ? await orgFor(req.admin.sub) : null;
    const {
      rows: [workspace],
    } = await pool.query(
      org
        ? 'SELECT id,name,slug,business_type,timezone,cancellation_cutoff_min FROM organizations WHERE id=$1'
        : 'SELECT id,name,slug,business_type,timezone,cancellation_cutoff_min FROM organizations ORDER BY id LIMIT 1',
      org ? [org] : [],
    );
    res.json({
      ...workspace,
      demoMode: config.demoMode,
      assistantProvider: process.env.AI_PROVIDER ?? 'mock',
    });
  }),
);
flowRouter.get(
  '/resources',
  asyncHandler(async (_req, res) => {
    res.json(await catalog());
  }),
);
flowRouter.get(
  '/resources/:id/slots',
  asyncHandler(async (req, res) => {
    const resourceId = id.parse(req.params.id);
    const input = z.object({ serviceId: id, date: dateSchema }).parse(req.query);
    res.json(await computeSlots(pool, resourceId, input.serviceId, input.date));
  }),
);
flowRouter.post(
  '/recommendations',
  asyncHandler(async (req, res) => {
    res.json(await recommend(preferencesSchema.parse(req.body)));
  }),
);
flowRouter.post(
  '/assistant/parse',
  asyncHandler(async (req, res) => {
    const { text } = z
      .object({ text: z.string().min(1).max(500) })
      .strict()
      .parse(req.body);
    const {
      rows: [workspace],
    } = await pool.query('SELECT timezone FROM organizations ORDER BY id LIMIT 1');
    res.json(await parseRequest(text, workspace?.timezone ?? 'UTC'));
  }),
);
flowRouter.post(
  '/assistant/chat',
  asyncHandler(async (req, res) => res.json(await chat(chatInput.parse(req.body), `ip:${req.ip}`))),
);
flowRouter.get(
  '/seat-pools',
  asyncHandler(async (_req, res) => res.json(await listSeatPools())),
);
flowRouter.get(
  '/seat-pool-requests',
  requireCustomer,
  asyncHandler(async (req, res) => res.json(await mySeatRequests(req.customer!.sub))),
);
flowRouter.post(
  '/seat-pools/:id/requests',
  requireCustomer,
  asyncHandler(async (req, res) => {
    const input = z
      .object({ partySize: z.number().int().min(1).max(20) })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(await joinSeatPool(id.parse(req.params.id), req.customer!.sub, input.partySize));
  }),
);
flowRouter.post(
  '/seat-pool-requests/:id/:action',
  requireCustomer,
  asyncHandler(async (req, res) => {
    const action = z.enum(['confirm', 'cancel']).parse(req.params.action);
    res.json(await changeSeatRequest(id.parse(req.params.id), req.customer!.sub, action));
  }),
);
flowRouter.post(
  '/holds',
  requireCustomer,
  asyncHandler(async (req, res) => {
    const input = z
      .object({ resourceId: id, serviceId: id, start: z.string().datetime({ offset: true }) })
      .strict()
      .parse(req.body);
    res.status(201).json(await hold(input, req.customer!.sub));
  }),
);
flowRouter.get(
  '/bookings',
  requireCustomer,
  asyncHandler(async (req, res) => {
    res.json(await myBookings(req.customer!.sub));
  }),
);
flowRouter.get(
  '/profile',
  requireCustomer,
  asyncHandler(async (req, res) => {
    const {
      rows: [profile],
    } = await pool.query('SELECT id,name,email,phone,created_at FROM customers WHERE id=$1', [
      req.customer!.sub,
    ]);
    if (!profile) return fail(404, 'Customer account not found');
    res.json(profile);
  }),
);
flowRouter.patch(
  '/profile',
  requireCustomer,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(2).max(100),
        phone: z.string().trim().max(30),
      })
      .strict()
      .parse(req.body);
    const {
      rows: [profile],
    } = await pool.query(
      'UPDATE customers SET name=$2,phone=$3 WHERE id=$1 RETURNING id,name,email,phone,created_at',
      [req.customer!.sub, input.name, input.phone],
    );
    if (!profile) return fail(404, 'Customer account not found');
    res.json(profile);
  }),
);
const passwordChange = z
  .object({ currentPassword: z.string().min(8).max(128), newPassword: z.string().min(12).max(128) })
  .strict();
async function changePassword(table: 'customers' | 'users', accountId: number, body: unknown) {
  const input = passwordChange.parse(body);
  const hash = await bcrypt.hash(input.newPassword, 12);
  await transaction(async (db) => {
    const {
      rows: [account],
    } = await db.query(`SELECT password_hash FROM ${table} WHERE id=$1 FOR UPDATE`, [accountId]);
    if (
      !account?.password_hash ||
      !(await bcrypt.compare(input.currentPassword, account.password_hash))
    )
      return fail(401, 'Current password is incorrect');
    if (await bcrypt.compare(input.newPassword, account.password_hash))
      return fail(400, 'Choose a different password');
    await db.query(
      `UPDATE ${table} SET password_hash=$2,session_version=session_version+1 WHERE id=$1`,
      [accountId, hash],
    );
  });
}
flowRouter.post(
  '/profile/password',
  requireCustomer,
  asyncHandler(async (req, res) => {
    await changePassword('customers', req.customer!.sub, req.body);
    res.status(204).end();
  }),
);
flowRouter.post(
  '/logout',
  requireCustomer,
  asyncHandler(async (req, res) => {
    await pool.query('UPDATE customers SET session_version=session_version+1 WHERE id=$1', [
      req.customer!.sub,
    ]);
    res.status(204).end();
  }),
);
flowRouter.post(
  '/admin/password',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await changePassword('users', req.admin!.sub, req.body);
    res.status(204).end();
  }),
);
flowRouter.post(
  '/admin/logout',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await pool.query('UPDATE users SET session_version=session_version+1 WHERE id=$1', [
      req.admin!.sub,
    ]);
    res.status(204).end();
  }),
);
flowRouter.post(
  '/bookings/:code/:action',
  requireCustomer,
  asyncHandler(async (req, res) => {
    const action = z.enum(['confirm', 'cancel', 'reschedule']).parse(req.params.action);
    const input = z
      .object({
        start: z.string().datetime({ offset: true }).optional(),
        version: z.number().int().positive().optional(),
      })
      .strict()
      .parse(req.body);
    if (action === 'reschedule' && !input.start) return fail(400, 'A new start time is required');
    res.json(
      await changeBooking(
        req.params.code as string,
        req.customer!.sub,
        action,
        input.start,
        input.version,
      ),
    );
  }),
);
flowRouter.get(
  '/requests',
  requireCustomer,
  asyncHandler(async (req, res) => {
    res.json(
      (
        await pool.query(
          `SELECT ar.*,p.name AS resource_name,o.timezone FROM allocation_requests ar JOIN providers p ON p.id=ar.resource_id JOIN organizations o ON o.id=p.organization_id WHERE ar.customer_id=$1 ORDER BY ar.created_at DESC`,
          [req.customer!.sub],
        )
      ).rows,
    );
  }),
);
flowRouter.post(
  '/requests',
  requireCustomer,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        resourceId: id,
        serviceId: id,
        date: dateSchema,
        earliestTime: timeSchema,
        latestTime: timeSchema,
      })
      .strict()
      .refine((v) => v.latestTime >= v.earliestTime, 'Latest time must follow earliest time')
      .parse(req.body);
    res.status(201).json(await joinQueue(input, req.customer!.sub));
  }),
);
flowRouter.delete(
  '/requests/:id',
  requireCustomer,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `UPDATE allocation_requests SET status='cancelled' WHERE id=$1 AND customer_id=$2 AND status='waiting' RETURNING *`,
      [id.parse(req.params.id), req.customer!.sub],
    );
    if (!result.rowCount)
      return fail(
        409,
        'Only waiting requests can be withdrawn. Release offered holds in My bookings.',
      );
    res.json(result.rows[0]);
  }),
);
flowRouter.get(
  '/notifications',
  requireCustomer,
  asyncHandler(async (req, res) => {
    res.json(
      (
        await pool.query(
          'SELECT id,title,message,created_at FROM flow_notifications WHERE customer_id=$1 ORDER BY id DESC LIMIT 50',
          [req.customer!.sub],
        )
      ).rows,
    );
  }),
);
flowRouter.use('/admin', requireAdmin);
async function orgFor(adminId: number) {
  const {
    rows: [u],
  } = await pool.query('SELECT organization_id FROM users WHERE id=$1', [adminId]);
  if (!u) return fail(403, 'Administrator not found');
  return u.organization_id as number;
}
flowRouter.get(
  '/admin/place-suggestions',
  asyncHandler(async (req, res) => {
    const query = z.string().trim().min(3).max(100).parse(req.query.q);
    const limit = await consumeLimit(`places:${req.admin!.sub}`, 30);
    if (!limit.allowed) {
      res.set('Retry-After', String(limit.retry));
      return res.status(429).json({ error: 'Too many place searches. Please try again shortly.' });
    }
    res.json(await suggestPlaces(query));
  }),
);
flowRouter.get(
  '/admin/seat-pools',
  asyncHandler(async (req, res) => res.json(await listSeatPools(await orgFor(req.admin!.sub)))),
);
flowRouter.post(
  '/admin/seat-pools',
  asyncHandler(async (req, res) =>
    res
      .status(201)
      .json(await publishSeatPool(await orgFor(req.admin!.sub), publishSchema.parse(req.body))),
  ),
);
flowRouter.post(
  '/admin/seat-pools/:id/allocate',
  asyncHandler(async (req, res) =>
    res.json(await allocateSeatPool(id.parse(req.params.id), await orgFor(req.admin!.sub))),
  ),
);
flowRouter.delete(
  '/admin/seat-pools/:id',
  asyncHandler(async (req, res) =>
    res.json(await withdrawSeatPool(id.parse(req.params.id), await orgFor(req.admin!.sub))),
  ),
);
flowRouter.get(
  '/admin/notifications',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT e.id,e.event,e.created_at,b.code,p.name AS resource_name,c.name AS customer_name
       FROM booking_events e
       JOIN bookings b ON b.id=e.booking_id
       JOIN providers p ON p.id=b.provider_id
       JOIN customers c ON c.id=b.customer_id
       WHERE p.organization_id=$1
       ORDER BY e.id DESC LIMIT 50`,
      [await orgFor(req.admin!.sub)],
    );
    const titles: Record<string, string> = {
      held: 'New booking hold',
      confirmed: 'Booking confirmed',
      cancelled: 'Booking cancelled',
      rescheduled: 'Booking rescheduled',
      expired: 'Booking hold expired',
      completed: 'Session completed',
      no_show: 'Customer did not attend',
    };
    res.json(
      rows.map((event) => ({
        id: event.id,
        title: titles[event.event] ?? 'Booking updated',
        message: `${event.customer_name} · ${event.resource_name} · ${event.code}`,
        created_at: event.created_at,
      })),
    );
  }),
);
flowRouter.get(
  '/admin/operations',
  asyncHandler(async (req, res) => {
    res.json(await operations(await orgFor(req.admin!.sub)));
  }),
);
flowRouter.patch(
  '/admin/resources/:id',
  asyncHandler(async (req, res) => {
    res.json(
      await updateResource(
        id.parse(req.params.id),
        await orgFor(req.admin!.sub),
        z.object({ active: z.boolean() }).strict().parse(req.body),
      ),
    );
  }),
);
flowRouter.post(
  '/admin/resources/:id/time-off',
  asyncHandler(async (req, res) => {
    const resourceId = id.parse(req.params.id),
      org = await orgFor(req.admin!.sub);
    const input = z
      .object({
        startLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
        endLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
        reason: z.string().trim().min(1).max(200),
      })
      .strict()
      .parse(req.body);
    const {
      rows: [r],
    } = await pool.query(
      'SELECT o.timezone FROM providers p JOIN organizations o ON o.id=p.organization_id WHERE p.id=$1 AND p.organization_id=$2',
      [resourceId, org],
    );
    if (!r) return fail(404, 'Resource not found');
    const start = wallTimeToInstant(input.startLocal, r.timezone),
      end = wallTimeToInstant(input.endLocal, r.timezone);
    if (end <= start) return fail(400, 'End must follow start');
    res.status(201).json(await blockTime(resourceId, org, start, end, input.reason, r.timezone));
  }),
);
flowRouter.patch(
  '/admin/bookings/:id',
  asyncHandler(async (req, res) => {
    const { status } = z
      .object({ status: z.enum(['completed', 'no_show']) })
      .strict()
      .parse(req.body);
    res.json(
      await finishBooking(
        id.parse(req.params.id),
        await orgFor(req.admin!.sub),
        status,
        `admin:${req.admin!.sub}`,
      ),
    );
  }),
);
flowRouter.get(
  '/admin/export',
  asyncHandler(async (req, res) => {
    await exportBookings(await orgFor(req.admin!.sub), res);
  }),
);

flowRouter.get(
  '/admin/settings',
  asyncHandler(async (req, res) => {
    res.json(await settings(await orgFor(req.admin!.sub)));
  }),
);
flowRouter.put(
  '/admin/settings',
  asyncHandler(async (req, res) => {
    res.json(
      await updateBusiness(
        await orgFor(req.admin!.sub),
        req.admin!.sub,
        businessSchema.parse(req.body),
      ),
    );
  }),
);
flowRouter.post(
  '/admin/resources',
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(
        await createResource(
          await orgFor(req.admin!.sub),
          req.admin!.sub,
          resourceSchema.parse(req.body),
        ),
      );
  }),
);
flowRouter.put(
  '/admin/resources/:id/schedule',
  asyncHandler(async (req, res) => {
    res.json(
      await replaceSchedule(
        await orgFor(req.admin!.sub),
        req.admin!.sub,
        id.parse(req.params.id),
        scheduleSchema.parse(req.body),
      ),
    );
  }),
);
flowRouter.post(
  '/admin/locations',
  asyncHandler(async (req, res) => {
    const input = z
      .object({ name: z.string().trim().min(2).max(100), address: z.string().max(300).default('') })
      .strict()
      .parse(req.body);
    const org = await orgFor(req.admin!.sub);
    res
      .status(201)
      .json(
        (
          await pool.query(
            'INSERT INTO locations(organization_id,name,address) VALUES($1,$2,$3) RETURNING *',
            [org, input.name, input.address],
          )
        ).rows[0],
      );
  }),
);

flowRouter.post(
  '/admin/resources/:id/services',
  asyncHandler(async (req, res) =>
    res
      .status(201)
      .json(
        await saveService(
          await orgFor(req.admin!.sub),
          req.admin!.sub,
          id.parse(req.params.id),
          serviceSchema.parse(req.body),
        ),
      ),
  ),
);
flowRouter.put(
  '/admin/resources/:id/services/:serviceId',
  asyncHandler(async (req, res) =>
    res.json(
      await saveService(
        await orgFor(req.admin!.sub),
        req.admin!.sub,
        id.parse(req.params.id),
        serviceSchema.parse(req.body),
        id.parse(req.params.serviceId),
      ),
    ),
  ),
);
flowRouter.put(
  '/admin/resources/:id',
  asyncHandler(async (req, res) =>
    res.json(
      await editResource(
        await orgFor(req.admin!.sub),
        req.admin!.sub,
        id.parse(req.params.id),
        resourceDetailsSchema.parse(req.body),
      ),
    ),
  ),
);
flowRouter.delete(
  '/admin/resources/:id/time-off/:timeOffId',
  asyncHandler(async (req, res) =>
    res.json(
      await removeTimeOff(
        await orgFor(req.admin!.sub),
        id.parse(req.params.id),
        id.parse(req.params.timeOffId),
      ),
    ),
  ),
);
flowRouter.put(
  '/admin/locations/:id',
  asyncHandler(async (req, res) => {
    const input = z
      .object({ name: z.string().trim().min(2).max(100), address: z.string().max(300) })
      .strict()
      .parse(req.body);
    const {
      rows: [location],
    } = await pool.query(
      'UPDATE locations SET name=$3,address=$4 WHERE id=$1 AND organization_id=$2 RETURNING *',
      [id.parse(req.params.id), await orgFor(req.admin!.sub), input.name, input.address],
    );
    if (!location) return fail(404, 'Location not found');
    res.json(location);
  }),
);
