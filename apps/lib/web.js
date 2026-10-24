// Minimal HTTP app helper: routing, in-memory cookie sessions, HTML rendering.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

export const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#1f2937}
  h1{font-size:1.4rem} pre{background:#f3f4f6;padding:.75rem;border-radius:6px;overflow-x:auto;font-size:.85rem}
  table{border-collapse:collapse;width:100%} td,th{border:1px solid #e5e7eb;padding:.4rem .6rem;text-align:left;font-size:.9rem}
  a.button,button{display:inline-block;background:#4f46e5;color:#fff;border:0;border-radius:6px;padding:.5rem 1rem;
    text-decoration:none;font-size:.95rem;cursor:pointer;margin:.25rem .25rem .25rem 0}
  a.secondary{background:#6b7280} label{display:block;margin-top:.75rem;font-weight:600}
  input{width:100%;padding:.45rem;border:1px solid #d1d5db;border-radius:6px;font-size:.95rem}
  .notice{background:#ecfdf5;border:1px solid #10b981;padding:.5rem .75rem;border-radius:6px}
</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;

// Default session store: in memory, for the process lifetime. Any { get(sid), set(sid, data) }
// async store can replace it (e.g. the Hub's Postgres store).
export const memorySessionStore = () => {
  const sessions = new Map();
  return { get: async (sid) => sessions.get(sid), set: async (sid, data) => { sessions.set(sid, data); } };
};

const readBody = (req, limit = 1_000_000) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', (chunk) => {
    data += chunk;
    if (data.length > limit) reject(Object.assign(new Error('Request body too large'), { status: 413 }));
  });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

// Options: `headers` set on every response; `secureCookies` adds `Secure` to the session cookie;
// `notFound(ctx)` / `onError(err, ctx)` replace the default HTML 404 / stack-trace 500 pages;
// `onListen()` replaces the startup console line. `cookieName` defaults to `sid_<port>`: browsers
// share cookies across ports, so apps on one host (localhost:3010, :3030) need distinct names.
export function startApp({ name, port, routes, sessionStore = memorySessionStore(), headers = {}, secureCookies = false, cookieName = `sid_${port}`, notFound, onError, onListen }) {
  const server = createServer(async (req, res) => {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    const url = new URL(req.url, `http://localhost:${port}`);
    const cookies = Object.fromEntries(
      (req.headers.cookie ?? '').split(';').map((p) => p.trim().split('=')).filter(([k]) => k)
    );
    let sid = cookies[cookieName];
    let session = sid ? await sessionStore.get(sid) : undefined;
    if (!session) {
      sid = randomBytes(16).toString('hex');
      session = {};
      res.setHeader('Set-Cookie', `${cookieName}=${sid}; HttpOnly; Path=/; SameSite=Lax${secureCookies ? '; Secure' : ''}`);
    }
    const initial = JSON.stringify(session);
    // Session changes are saved before the response is written, so the next request sees them.
    const send = async (status, responseHeaders, body) => {
      if (JSON.stringify(session) !== initial) await sessionStore.set(sid, session);
      res.writeHead(status, responseHeaders);
      res.end(body);
    };
    const ctx = {
      url,
      req,
      session,
      ip: req.socket.remoteAddress,
      send,
      redirect: (to) => send(302, { Location: to }),
      html: (body, status = 200) => send(status, { 'Content-Type': 'text/html; charset=utf-8' }, body),
      json: (body, status = 200) => send(status, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(body)),
      form: async () => Object.fromEntries(new URLSearchParams(await readBody(req))),
      text: () => readBody(req),
      body: async () => {
        const text = await readBody(req);
        return text ? JSON.parse(text) : {};
      },
    };
    const handler = routes[`${req.method} ${url.pathname}`];
    try {
      if (!handler) return await (notFound ? notFound(ctx) : ctx.html(page('Not found', '<p>404</p>'), 404));
      await handler(ctx);
    } catch (err) {
      if (onError) return onError(err, ctx);
      console.error(err);
      ctx.html(page('Error', `<pre>${escapeHtml(err?.stack ?? err)}</pre>`), 500);
    }
  });
  server.listen(port, onListen ?? (() => console.log(`${name}: http://localhost:${port}`)));
  return server;
}
