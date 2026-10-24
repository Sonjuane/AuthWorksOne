// Re-seals every vault record under HUB_MASTER_KEY_CURRENT (VA-02 key rotation). Keep the old
// version in HUB_MASTER_KEYS until this reports 0 everywhere. "+" = re-encrypted, "=" = current.
import { connect } from '../apps/hub/core/db.js';
import { reencrypt } from '../apps/hub/core/sealed.js';
import { createVault, parseMasterKeys } from '../apps/hub/core/vault.js';
import { need } from './lib/logto.js';

const vault = createVault({ keys: parseMasterKeys(need('HUB_MASTER_KEYS')), current: need('HUB_MASTER_KEY_CURRENT') });
const sql = connect(need('HUB_DATABASE_URL'), { max: 1 });
console.log(`Re-encrypting to key version ${vault.current}`);
for (const [table, count] of Object.entries(await reencrypt(sql, vault))) console.log(`  ${count ? `+ ${table}: ${count} row(s)` : `= ${table}: 0 rows`}`);
await sql.end();
