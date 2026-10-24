// Structured JSON logger (NF-09) with secret redaction (VA-07): values under secret-looking keys
// and any value registered with registerSecret() are replaced before a line is written.
const SECRET_KEY = /token|secret|password|passwd|authorization|cookie|api[-_]?key|verifier|signing|^code$|^sealed$/i;
const REDACTED = '[REDACTED]';

export function createLogger({ write = (line) => process.stdout.write(`${line}\n`), base = {} } = {}) {
  const secrets = new Set();
  const transient = new Set();

  const scrub = (text) => {
    let out = text;
    for (const set of [secrets, transient]) for (const secret of set) out = out.split(secret).join(REDACTED);
    return out;
  };
  const redact = (value, key = '') => {
    if (value === null || value === undefined) return value;
    if (SECRET_KEY.test(key)) return REDACTED;
    if (typeof value === 'string') return scrub(value);
    if (Array.isArray(value)) return value.map((v) => redact(v));
    if (value instanceof Error) return { name: value.name, message: scrub(value.message) };
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
    return value;
  };
  const emit = (level, event, fields = {}) =>
    write(JSON.stringify({ time: new Date().toISOString(), level, event, ...redact({ ...base, ...fields }) }));

  return {
    // Values shorter than 8 chars are ignored to avoid redacting common substrings.
    // registerSecret: kept for the process lifetime (startup secrets).
    // registerTransient: provider credentials seen per request; the oldest are dropped past 10,000.
    registerSecret: (value) => { if (typeof value === 'string' && value.length >= 8) secrets.add(value); },
    registerTransient: (value) => {
      if (typeof value !== 'string' || value.length < 8 || secrets.has(value)) return;
      transient.add(value);
      if (transient.size > 10_000) transient.delete(transient.values().next().value);
    },
    redact,
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}
