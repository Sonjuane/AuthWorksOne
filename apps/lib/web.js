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

export function startApp({ name, port, routes }) {
  const sessions = new Map();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const cookies = Object.fromEntries(
      (req.headers.cookie ?? '').split(';').map((p) => p.trim().split('=')).filter(([k]) => k)
    );
    let sid = cookies.sid;
    if (!sid || !sessions.has(sid)) {
      sid = randomBytes(16).toString('hex');
      sessions.set(sid, {});
      res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
    }
    const ctx = {
      url,
      session: sessions.get(sid),
      redirect: (to) => { res.writeHead(302, { Location: to }); res.end(); },
      html: (body, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
      },
      form: () => new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk) => { data += chunk; });
        req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(data))));
      }),
    };
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return ctx.html(page('Not found', '<p>404</p>'), 404);
    try {
      await handler(ctx);
    } catch (err) {
      console.error(err);
      ctx.html(page('Error', `<pre>${escapeHtml(err?.stack ?? err)}</pre>`), 500);
    }
  });
  server.listen(port, () => console.log(`${name}: http://localhost:${port}`));
}
