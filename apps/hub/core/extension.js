// Helpers for Hub extension modules (auth type handlers). Core never imports a handler by name;
// handlers import from here (EX-02).

// Failure a handler reports to core. Codes core acts on:
// `provider_denied`, `refresh_failed` / `provider_unauthorized` (-> needs_reauth), `provider_unavailable`,
// `invalid_input`, `refresh_not_supported`.
export class HandlerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const FUNCTION_MEMBERS = ['authorize', 'handleCallback', 'collectCredentials', 'refresh', 'revoke', 'test', 'getCredentials'];

// Interface violations of an auth type handler (apps/hub/auth-types/types.js); empty when valid.
export function interfaceErrors(handler) {
  const errors = [];
  for (const name of FUNCTION_MEMBERS) {
    if (handler[name] !== undefined && typeof handler[name] !== 'function') errors.push(`${name} must be a function`);
  }
  for (const name of ['test', 'getCredentials']) if (typeof handler[name] !== 'function') errors.push(`${name} is required`);
  const redirect = typeof handler.authorize === 'function' && typeof handler.handleCallback === 'function';
  const collect = typeof handler.collectCredentials === 'function';
  if (redirect === collect) errors.push('implement exactly one of authorize + handleCallback, or collectCredentials');
  return errors;
}

// "{{name}}" placeholders; unknown names render empty.
export const render = (template, vars) => template.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? '');

export const getPath = (obj, path) => (path ? path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj) : undefined);

// Variables a credential exposes to connector templates (test headers, `auth.format`).
export const templateVars = (credential) => ({
  accessToken: credential.accessToken,
  apiKey: credential.apiKey,
  username: credential.username,
  basic: credential.username !== undefined ? Buffer.from(`${credential.username}:${credential.password}`).toString('base64') : undefined,
});

// Provider API base for a connection: fixed, or from a credential field (+ optional suffix).
export const resolveBaseUrl = (definition, input = {}) =>
  definition.baseUrl.fixed ?? `${String(input[definition.baseUrl.fromField] ?? '').replace(/\/+$/, '')}${definition.baseUrl.pathSuffix ?? ''}`;

// HandlerCtx (apps/hub/auth-types/types.js) for a registry connector entry.
export const handlerContext = (entry, { input, baseUrl, redirectUri, http = fetch }) => ({
  connector: entry.definition,
  client: entry.client ?? {},
  baseUrl: baseUrl ?? resolveBaseUrl(entry.definition, input),
  redirectUri,
  http,
});

// Runs the connector's credential test request (VA-03). Provider 401/403 -> ok: false.
export async function runTestRequest(ctx, credential) {
  const { test } = ctx.connector;
  const vars = templateVars(credential);
  const headers = Object.fromEntries(Object.entries(test.headers ?? {}).map(([k, v]) => [k, render(v, vars)]));
  const res = await ctx.http(`${ctx.baseUrl}${render(test.path, vars)}`, { method: test.method, headers: { accept: 'application/json', ...headers } });
  if (res.status >= 500) throw new HandlerError('provider_unavailable', `test request -> ${res.status}`);
  const ok = res.status === (test.expectStatus ?? 200);
  const body = ok ? await res.json().catch(() => ({})) : undefined;
  const id = getPath(body, test.accountIdPath);
  return { ok, status: res.status, ...(ok && id !== undefined ? { account: { id: String(id), name: getPath(body, test.accountNamePath) } } : {}) };
}
