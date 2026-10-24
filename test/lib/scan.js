// Leak scans (spec §7.4, S12-S14): find plaintext secrets in text, database columns, and JSON values.

// Needles (strings) and patterns (RegExp) found in `text`.
export const textHits = (text, needles = [], patterns = []) => [
  ...needles.filter((needle) => needle && text.includes(needle)),
  ...patterns.flatMap((pattern) => text.match(new RegExp(pattern, 'g')) ?? []),
];

// Every text/json/bytea column in schema `public`: rows containing a needle -> "table.column: needle".
export async function databaseHits(sql, needles) {
  const columns = await sql`
    select table_name, column_name, data_type from information_schema.columns
    where table_schema = 'public' and data_type in ('text', 'character varying', 'json', 'jsonb', 'bytea')`;
  const hits = [];
  for (const { table_name: table, column_name: column, data_type: type } of columns) {
    const rows = await sql`select ${sql(column)} as v from ${sql(table)} where ${sql(column)} is not null`;
    for (const { v } of rows) {
      const value = type === 'bytea' ? Buffer.from(v) : typeof v === 'string' ? v : JSON.stringify(v);
      for (const needle of needles) if (needle && value.includes(needle)) hits.push(`${table}.${column}: ${needle.slice(0, 12)}…`);
    }
  }
  return hits;
}

// JSON paths whose key matches `keyPattern`.
export const keyPaths = (value, keyPattern, path = '$') => {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(keyPattern.test(key) ? [`${path}.${key}`] : []),
    ...keyPaths(child, keyPattern, `${path}.${key}`),
  ]);
};
