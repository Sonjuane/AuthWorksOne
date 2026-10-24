// Management API client: M2M client-credentials token + authenticated fetch.
const MANAGEMENT_RESOURCE = 'https://default.logto.app/api';

export const need = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var: ${key} (see .env.example)`);
  return value;
};

export const endpoint = () => need('LOGTO_ENDPOINT').replace(/\/$/, '');

let token;
let tokenExpiresAt = 0;

async function getToken() {
  if (token && Date.now() < tokenExpiresAt - 30_000) return token;
  const auth = Buffer.from(`${need('LOGTO_M2M_CLIENT_ID')}:${need('LOGTO_M2M_CLIENT_SECRET')}`).toString('base64');
  const res = await fetch(`${endpoint()}/oidc/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${auth}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      resource: MANAGEMENT_RESOURCE,
      scope: 'all',
    }),
  });
  if (!res.ok) throw new Error(`M2M token request failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  token = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return token;
}

export async function api(method, path, body) {
  const res = await fetch(`${endpoint()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return data;
}
