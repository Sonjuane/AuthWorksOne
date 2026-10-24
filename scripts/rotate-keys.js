// Rotates OIDC signing keys via the Management API, then verifies the new key via JWKS.
// Usage: npm run rotate-keys [-- --alg EC|RSA] [-- --cookie]
import { api, endpoint } from './lib/logto.js';

const args = process.argv.slice(2);
const keyType = args.includes('--cookie') ? 'cookie-keys' : 'private-keys';
const alg = args.includes('--alg') ? args[args.indexOf('--alg') + 1] : 'EC';

const keys = await api(
  'POST',
  `/api/configs/oidc/${keyType}/rotate`,
  keyType === 'private-keys' ? { signingKeyAlgorithm: alg } : undefined
);
console.log(`Rotated ${keyType}:`);
for (const key of keys) console.log(`  ${key.id} (created ${new Date(key.createdAt * 1000).toISOString()})`);

if (keyType === 'private-keys') {
  const jwks = await fetch(`${endpoint()}/oidc/jwks`).then((r) => r.json());
  console.log(`JWKS now serves ${jwks.keys.length} key(s): ${jwks.keys.map((k) => k.kid).join(', ')}`);
  console.log('Old key remains in JWKS until you delete it (see docs/01-runbook.md §5).');
}
