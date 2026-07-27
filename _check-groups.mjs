import dotenv from 'dotenv';
dotenv.config({path:'.env.local'});
import pg from 'pg';
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const g = await pool.query('SELECT id, name, url, status FROM jobhunter_groups ORDER BY id');
console.log('=== CONFIGURED GROUPS (' + g.rows.length + ') ===');
g.rows.forEach(g => console.log('  [' + g.id + '] (status=' + g.status + ') ' + g.name + '\n       ' + g.url));
await pool.end();
