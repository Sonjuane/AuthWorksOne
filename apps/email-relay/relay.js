// Cloudflare email relay (EM-01, EM-03): receives Logto's http-email connector POST
// `{to, type, payload}`, renders the config template for `type`, and sends it through the
// Cloudflare Email Sending REST API. `fetch` is injectable for tests.
import { timingSafeEqual } from 'node:crypto';
import { startApp } from '../lib/web.js';

export const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

// Template for `type` (falls back to `Generic`); `{{key}}` is replaced by payload[key].
export function renderEmail(templates, { type, payload = {} }) {
  const template = templates.find((t) => t.usageType === type) ?? templates.find((t) => t.usageType === 'Generic');
  if (!template) throw Object.assign(new Error(`no email template for "${type}" and no Generic template`), { status: 400 });
  const fill = (text) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => payload[key] ?? match);
  return { subject: fill(template.subject), text: fill(template.content) };
}

const sameSecret = (a = '', b = '') => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function startRelay({ port, templates, authorization, from, accountId, apiToken, apiBase = CF_API_BASE, fetch = globalThis.fetch, onListen }) {
  return startApp({
    name: 'Email relay',
    port,
    onListen,
    notFound: (ctx) => ctx.json({ error: 'not_found' }, 404),
    onError: (err, ctx) => ctx.json({ error: err.message }, err.status ?? 500),
    routes: {
      'GET /health': (ctx) => ctx.json({ status: 'ok' }),
      'POST /email': async (ctx) => {
        if (!sameSecret(ctx.req.headers.authorization, authorization)) return ctx.json({ error: 'unauthorized' }, 401);
        const { to, type, payload } = await ctx.body();
        if (typeof to !== 'string' || typeof type !== 'string' || typeof payload?.code !== 'string') {
          return ctx.json({ error: 'expected {to, type, payload.code}' }, 400);
        }
        const res = await fetch(`${apiBase}/accounts/${accountId}/email/sending/send`, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ to, from, ...renderEmail(templates, { type, payload }) }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success || body.result?.permanent_bounces?.length) {
          console.error(`[email-relay] ${type} send failed: ${res.status} ${JSON.stringify(body.errors?.length ? body.errors : body.result)}`);
          return ctx.json({ error: 'send_failed', status: res.status, errors: body.errors ?? [], result: body.result ?? null }, 502);
        }
        console.log(`[email-relay] ${type} sent (${body.result?.queued?.length ? 'queued' : 'delivered'})`);
        return ctx.json({ status: 'ok' });
      },
    },
  });
}
