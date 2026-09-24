import pg from 'pg';
import { config } from '../config.js';

// SQL DATE is a calendar date, never a server-local JavaScript midnight.
pg.types.setTypeParser(1082, value => value);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.poolMax,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 15000,
});

pool.on('error', (err) => {
  console.error('Unexpected PG pool error:', err.message);
});
