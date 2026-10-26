// Email relay entry point: templates from config `email.templates`, secrets from env.
// Refuses to start (exit 1) when any required env var is missing.
import { readFileSync } from 'node:fs';
import { startRelay } from './relay.js';

const missing = ['EMAIL_RELAY_TOKEN', 'EMAIL_RELAY_FROM', 'CF_ACCOUNT_ID', 'CF_EMAIL_API_TOKEN'].filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Email relay: env vars not set: ${missing.join(', ')}`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(new URL('../../config/sso.config.json', import.meta.url)));
startRelay({
  port: 3096,
  templates: config.email.templates,
  authorization: process.env.EMAIL_RELAY_TOKEN,
  from: process.env.EMAIL_RELAY_FROM,
  accountId: process.env.CF_ACCOUNT_ID,
  apiToken: process.env.CF_EMAIL_API_TOKEN,
});
