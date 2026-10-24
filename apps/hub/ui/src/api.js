// Hub UI API client: same-origin session cookie, CSRF header on writes, envelope unwrapping,
// and readable messages for stable error codes.
let csrfToken = null;
export const setCsrf = (token) => { csrfToken = token; };

export class UiError extends Error {
  constructor(status, error = {}) {
    super(error.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = error.code;
  }
}

export const loginUrl = () => `/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`;

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json', 'x-csrf-token': csrfToken ?? '' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && json.error?.code === 'login_required') location.href = loginUrl();
  if (!res.ok) throw new UiError(res.status, json.error);
  return json.data;
}

const MESSAGES = {
  connection_test_failed: 'The provider rejected those credentials. Check them and try again.',
  invalid_input: 'That value was refused. Site URLs must use https:// and be publicly reachable.',
  provider_denied: 'The provider did not grant access.',
  provider_unavailable: 'The provider is not responding. Try again in a moment.',
  invalid_state: 'That connect attempt expired. Start again.',
  connector_not_available: 'This connector is not available right now.',
  connector_not_allowed_for_client: 'This app is not allowed to use that kind of connection.',
  client_not_registered: 'This app is not registered with the Connector Hub.',
  csrf_failed: 'Your session changed. Reload the page and try again.',
  forbidden: 'You do not have access to this page.',
};
export const describeError = (err) => MESSAGES[err?.code] ?? err?.message ?? 'Something went wrong.';
