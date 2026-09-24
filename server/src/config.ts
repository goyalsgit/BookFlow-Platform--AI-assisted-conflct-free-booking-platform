import dotenv from 'dotenv';
dotenv.config();

export const production = process.env.NODE_ENV === 'production';
export function validateProductionEnvironment(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== 'production') return;
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || /dev-secret|replace-with|test-secret/i.test(env.JWT_SECRET))
    throw new Error('Set a unique JWT_SECRET of at least 32 characters in production');
}
validateProductionEnvironment(process.env);
function positiveInt(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

export const config = {
  port: positiveInt('PORT', 4170),
  poolMax: positiveInt('DB_POOL_MAX', 10),
  maintenanceEnabled: process.env.MAINTENANCE_ENABLED !== 'false',
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : false,
  demoMode: process.env.DEMO_MODE === 'true' || !production,
  notificationMode: process.env.NOTIFICATION_MODE ?? (production ? 'inbox' : 'file'),
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://bookflow:bookflow_local@localhost:54329/bookflow',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-do-not-use-in-prod',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5175',
  mail: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM ?? '"BookFlow" <no-reply@bookflow.local>',
  },
  payments: {
    provider: (process.env.PAYMENT_PROVIDER ?? 'mock') as 'mock',
    holdMinutes: Number(process.env.PAYMENT_HOLD_MINUTES ?? 10),
    mockSecret: process.env.MOCK_PAY_SECRET ?? 'mockpay-dev-secret',
  },
  refundPolicy: {
    fullBeforeHours: Number(process.env.REFUND_FULL_BEFORE_HOURS ?? 24),
    feePct: Number(process.env.REFUND_FEE_PCT ?? 25),
    noneWithinHours: Number(process.env.REFUND_NONE_WITHIN_HOURS ?? 2),
  },
};
