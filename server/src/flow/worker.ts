import {startMaintenance} from './maintenance.js';
import {pool} from '../db/pool.js';
const stop=startMaintenance();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void stop().then(()=>pool.end()).then(()=>process.exit(0));});
