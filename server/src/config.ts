import dotenv from 'dotenv';
dotenv.config();

export const production = process.env.NODE_ENV === 'production';
export function validateProductionEnvironment(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== 'production') return;
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
  if (
    !env.JWT_SECRET ||
    env.JWT_SECRET.length < 32 ||
    /dev-secret|replace-with|test-secret/i.test(env.JWT_SECRET)
  )
    throw new Error('Set a unique JWT_SECRET of at least 32 characters in production');
  if (!env.SMTP_HOST || !env.MAIL_FROM || !env.CLIENT_ORIGIN?.startsWith('https://'))
    throw new Error('SMTP_HOST, MAIL_FROM, and an HTTPS CLIENT_ORIGIN are required in production');
}
validateProductionEnvironment(process.env);
function positiveInt(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

const poolMax = positiveInt('DB_POOL_MAX', 10);
const maintenanceEnabled = process.env.MAINTENANCE_ENABLED !== 'false';
// Maintenance holds one leadership connection while its tasks use another.
if (maintenanceEnabled && poolMax < 2)
  throw new Error('DB_POOL_MAX must be at least 2 when maintenance is enabled');

export const config = {
  port: positiveInt('PORT', 4170),
  poolMax,
  maintenanceEnabled,
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
};
