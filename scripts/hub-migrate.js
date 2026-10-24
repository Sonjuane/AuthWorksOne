// Applies pending Hub migrations (NF-08). "+" = applied now, "=" = already applied.
import { connect } from '../apps/hub/core/db.js';
import { migrate } from '../apps/hub/core/migrate.js';
import { need } from './lib/logto.js';

const sql = connect(need('HUB_DATABASE_URL'), { max: 1 });
console.log('Hub migrations');
await migrate(sql, (line) => console.log(`  ${line}`));
await sql.end();
