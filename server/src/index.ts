import {app} from './app.js';
import {config} from './config.js';
import {pool} from './db/pool.js';
import {startMaintenance} from './flow/maintenance.js';
const stopMaintenance=config.maintenanceEnabled?startMaintenance():async()=>{};
const server=app.listen(config.port,'0.0.0.0',()=>console.log(`BookFlow listening on port ${config.port}`));
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
 if(stopping)return;stopping=true;
 const deadline=setTimeout(()=>process.exit(1),25000);deadline.unref();
 server.close(()=>{void stopMaintenance().then(()=>pool.end()).then(()=>process.exit(0));});
});
