// Mock provider as a standalone service (compose `mock-provider`, profile `test`; port 3097).
// HTTP control API for E2E tests:
//   POST /_control/reset | /_control/expire | /_control/fail-refresh {"value":true}
//   POST /_control/app-password {"user","password"} | /_control/api-key {"key"} | /_control/expires-in {"seconds"}
//   GET  /_control/calls
import { createServer } from 'node:http';
import { createMockProvider } from './app.js';

const port = Number(process.env.MOCK_PROVIDER_PORT ?? 3097);
const { handle, control } = createMockProvider();

const controlRoutes = {
  'POST /_control/reset': () => control.reset(),
  'POST /_control/expire': () => control.expireAccessTokens(),
  'POST /_control/fail-refresh': (body) => control.setFailRefresh(body.value !== false),
  'POST /_control/expires-in': (body) => control.setExpiresIn(Number(body.seconds)),
  'POST /_control/app-password': (body) => control.addAppPassword(body.user, body.password),
  'POST /_control/api-key': (body) => control.addApiKey(body.key),
  'GET /_control/calls': () => control.calls(),
};

createServer(async (req, res) => {
  const route = controlRoutes[`${req.method} ${new URL(req.url, 'http://mock').pathname}`];
  if (!route) return handle(req, res).catch((err) => { res.writeHead(500); res.end(err.message); });
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const result = route(raw ? JSON.parse(raw) : {});
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(result ?? { ok: true }));
}).listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'mock_provider_started', port })));
