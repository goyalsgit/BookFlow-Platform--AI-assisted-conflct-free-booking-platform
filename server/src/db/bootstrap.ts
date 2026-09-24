import bcrypt from 'bcryptjs';
import {z} from 'zod';
import {pool} from './pool.js';
const db=await pool.connect();
try {
 const input=z.object({email:z.string().email(),password:z.string().min(12).max(128),name:z.string().min(2)}).parse({email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD,name:process.env.ADMIN_NAME??'Workspace administrator'});
 await db.query('BEGIN');
 await db.query('SELECT pg_advisory_xact_lock(73021,3)');
 if((await db.query('SELECT 1 FROM users LIMIT 1')).rowCount)throw new Error('An administrator already exists. No account was changed.');
 const {rows:[org]}=await db.query('SELECT id FROM organizations ORDER BY id LIMIT 1');
 if(!org)throw new Error('Run migrations first.');
 await db.query('INSERT INTO users(name,email,password_hash,organization_id) VALUES($1,lower($2),$3,$4)',[input.name,input.email,await bcrypt.hash(input.password,12),org.id]);
 await db.query('COMMIT');console.log('Administrator created. Remove ADMIN_PASSWORD from the deployment environment.');
} catch(error:any){await db.query('ROLLBACK');console.error(error instanceof z.ZodError?'Provide ADMIN_EMAIL, ADMIN_PASSWORD (12+ characters), and ADMIN_NAME.':error.message);process.exitCode=1;}
finally{db.release();await pool.end();}
