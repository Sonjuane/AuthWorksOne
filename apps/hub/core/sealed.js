// Tables holding vault-sealed values, and the AAD binding each value to its row (VA-02).
// Every new sealed column must be listed here so `npm run hub:reencrypt` covers it.
export const SEALED_TABLES = [
  { table: 'connection_secrets', id: 'connection_id' },
  { table: 'oauth_states', id: 'state_hash' },
  { table: 'sessions', id: 'sid_hash' },
];

export const aadFor = (tenantId, table, id) => `${tenantId}|${table}|${id}`;

// Re-seals every row whose key version is not the vault's current one; returns counts per table.
export async function reencrypt(sql, vault) {
  const counts = {};
  for (const { table, id } of SEALED_TABLES) {
    counts[table] = 0;
    await sql.begin(async (tx) => {
      const rows = await tx`select tenant_id, ${tx(id)} as id, sealed from ${tx(table)} where key_version <> ${vault.current} for update`;
      for (const row of rows) {
        const aad = aadFor(row.tenant_id, table, row.id);
        const sealed = vault.seal(vault.open(row.sealed, aad), aad);
        await tx`update ${tx(table)} set sealed = ${sealed}, key_version = ${vault.current} where tenant_id = ${row.tenant_id} and ${tx(id)} = ${row.id}`;
        counts[table]++;
      }
    });
  }
  return counts;
}
