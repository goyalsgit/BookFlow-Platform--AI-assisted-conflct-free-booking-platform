import {createHmac} from 'node:crypto';
import {pool} from '../db/pool.js';
import {config} from '../config.js';
import {asyncHandler} from '../middleware/errors.js';
export async function consumeLimit(identity: string, limit: number, windowSeconds = 60) {
 const key = createHmac('sha256', config.jwtSecret).update(identity).digest('hex');
 const {rows:[row]} = await pool.query(`INSERT INTO request_limits(key,hits,resets_at)
 VALUES($1,1,clock_timestamp()+make_interval(secs=>$2))
 ON CONFLICT(key) DO UPDATE SET
 hits=CASE WHEN request_limits.resets_at<=clock_timestamp() THEN 1 ELSE request_limits.hits+1 END,
 resets_at=CASE WHEN request_limits.resets_at<=clock_timestamp() THEN clock_timestamp()+make_interval(secs=>$2) ELSE request_limits.resets_at END
 RETURNING hits,GREATEST(1,ceil(extract(epoch FROM(resets_at-clock_timestamp()))))::int AS retry`,[key,windowSeconds]);
 return {allowed:row.hits<=limit,retry:row.retry};
}
export const rateLimit = asyncHandler(async (req,res,next) => {
 const auth = req.path.includes('session') || req.path.endsWith('/register');
 const result = await consumeLimit(`${req.ip}:${auth?'auth':'api'}`, auth?30:600);
 if (!result.allowed) {res.set('Retry-After',String(result.retry));res.status(429).json({error:'Too many requests. Please try again shortly.'});return;}
 next();
});
