import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import cors from 'cors';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { flowRouter } from './flow/router.js';
import { errorHandler } from './middleware/errors.js';
export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use((req,res,next) => {
 const requestId=randomUUID();res.set('X-Request-Id',requestId);
 res.set('X-Content-Type-Options','nosniff');
 res.set('Referrer-Policy','same-origin');
 res.set('X-Frame-Options','DENY');
 const start=Date.now();
 res.on('finish',()=>{if(process.env.NODE_ENV==='production') console.log(JSON.stringify({requestId,method:req.method,path:req.path,status:res.statusCode,durationMs:Date.now()-start}));});
 next();
});
app.use(cors({ origin: config.clientOrigin }));
app.use(express.json({ limit: '32kb' }));
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up', product: 'BookFlow' });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});
app.use('/api/flow', flowRouter);
app.use('/api', (_req,res)=>res.status(404).json({error:'Endpoint not found'}));
const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if(existsSync(path.join(frontend,'index.html'))){
 app.use('/assets',express.static(path.join(frontend,'assets'),{immutable:true,maxAge:'1y'}));
 app.use(express.static(frontend,{maxAge:0}));
 app.get('*',(req,res,next)=>{
  if(path.extname(req.path) || !req.accepts('html')) return next();
  res.set('Cache-Control','no-cache').sendFile(path.join(frontend,'index.html'));
 });
}
app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found' }));
app.use(errorHandler);
