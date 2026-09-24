import {maintenance} from './maintenance.js';
import {pool} from '../db/pool.js';
try {await maintenance();console.log('Maintenance completed.');} finally {await pool.end();}
