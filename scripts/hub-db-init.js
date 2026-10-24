// Idempotent: creates the Hub's own Postgres role and database on the shared Postgres container
// (NF-02). "+" = created, "=" = exists (role password re-synced from HUB_DB_PASSWORD).
import { connect } from '../apps/hub/core/db.js';
import { need } from './lib/logto.js';

const host = process.env.POSTGRES_HOST ?? 'localhost';
const port = process.env.POSTGRES_PORT ?? 5432;
const admin = connect(`postgres://logto:${encodeURIComponent(need('POSTGRES_PASSWORD'))}@${host}:${port}/logto`, { max: 1 });
const literal = (value) => `'${value.replace(/'/g, "''")}'`;
const password = literal(need('HUB_DB_PASSWORD'));

console.log('Hub database');
const [role] = await admin`select 1 from pg_roles where rolname = 'hub'`;
await admin.unsafe(`${role ? 'alter' : 'create'} role hub with login password ${password}`);
console.log(`  ${role ? '= role hub (password synced)' : '+ role hub'}`);

const [database] = await admin`select 1 from pg_database where datname = 'hub'`;
if (!database) await admin.unsafe('create database hub owner hub');
await admin.unsafe('revoke all on database hub from public');
console.log(`  ${database ? '=' : '+'} database hub (owner hub)`);
await admin.end();
