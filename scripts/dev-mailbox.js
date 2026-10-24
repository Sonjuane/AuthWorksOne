// Dev-only mailbox for the http-email fallback connector: Logto POSTs
// verification emails here; codes print to the console and are listed via GET /.
import { createServer } from 'node:http';

const port = Number(process.env.DEV_MAILBOX_PORT ?? 3099);
const messages = [];

createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(messages));
  }
  let data = '';
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => {
    const message = { receivedAt: new Date().toISOString(), body: data };
    messages.push(message);
    console.log(`[dev-mailbox] ${message.receivedAt} ${data}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"ok"}');
  });
}).listen(port, () => console.log(`Dev mailbox (email verification codes): http://localhost:${port}`));
