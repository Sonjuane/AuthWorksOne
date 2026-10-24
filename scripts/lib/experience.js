// Scripted sign-ins through Logto's Experience API (what the hosted sign-in page calls):
// cookie-jar browser, PKCE authorization, password/MFA/social steps, code-for-token exchange.
import { createHash, randomBytes } from 'node:crypto';
import { decodeJwt } from 'jose';
import { endpoint } from './logto.js';
import { totp } from './totp.js';

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

// Throws on HTTP >= 400; returns the parsed body.
export const ok = (res, what) => {
  if (res.status >= 400) throw new Error(`${what} -> ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
};

const parse = (text) => {
  try { return text ? JSON.parse(text) : null; } catch { return text; }
};

// Minimal browser: cookie jar, no automatic redirects, JSON in/out. Relative URLs resolve to
// `base` (default: Logto).
export function browser(base = endpoint()) {
  const jar = new Map();
  return async (method, url, body, headers = {}) => {
    const res = await fetch(new URL(url, base), {
      method,
      redirect: 'manual',
      headers: {
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return { status: res.status, location: res.headers.get('location'), data: parse(await res.text()) };
  };
}

// Submits the interaction, skipping the optional MFA set-up prompt (Prompt* policies raise
// `user.suggest_mfa`) like the hosted page's "skip" button. Mandatory MFA is returned unchanged.
const submit = async (req) => {
  const res = await req('POST', '/api/experience/submit');
  const skippable = res.data?.code === 'user.suggest_mfa' || (res.data?.code === 'user.missing_mfa' && res.data?.data?.skippable);
  if (!skippable) return res;
  ok(await req('POST', '/api/experience/profile/mfa/mfa-skipped'), 'skip MFA prompt');
  return req('POST', '/api/experience/submit');
};

// Follows Logto's post-submit redirects (auto-approving first-party consent) until `done(url)`.
const followRedirects = async (req, start, done) => {
  const logtoOrigin = new URL(endpoint()).origin;
  let location = new URL(start, endpoint()).href;
  for (let i = 0; i < 10 && !done(location); i++) {
    const url = new URL(location);
    if (url.origin === logtoOrigin && url.pathname.startsWith('/consent')) {
      location = new URL(ok(await req('POST', '/api/interaction/consent', {}), 'consent').redirectTo, endpoint()).href;
      continue;
    }
    const res = await req('GET', location);
    if (!res.location) throw new Error(`redirect chain stopped at ${location} (${res.status})`);
    location = new URL(res.location, location).href;
  }
  return location;
};

// Password sign-in steps inside an open experience interaction; returns the submit redirect.
const passwordSteps = async (req, email, password) => {
  const pw = ok(await req('POST', '/api/experience/verification/password', { identifier: { type: 'email', value: email }, password }), 'password');
  ok(await req('POST', '/api/experience/identification', { verificationId: pw.verificationId }), 'identification');
  return ok(await submit(req), 'submit').redirectTo;
};

// Signs in through an app's own login route (the app runs PKCE/state, e.g. the Hub's /login) and
// returns that app's browser, holding the signed-in session cookie. With an existing Logto
// session in `logto` (pass the browser from a previous call), sign-in is silent (SSO).
export async function appSignIn({ appUrl, loginPath = '/login', email, password, logto = browser() }) {
  const app = browser(appUrl);
  const appOrigin = new URL(appUrl).origin;
  const start = await app('GET', loginPath);
  if (!start.location) throw new Error(`${appUrl}${loginPath} did not redirect (${start.status})`);
  const authorize = await logto('GET', start.location);
  let location = new URL(authorize.location, start.location).href;
  const atApp = (url) => new URL(url).origin === appOrigin;
  if (!atApp(location) && new URL(location).pathname.startsWith('/sign-in')) {
    // No usable Logto session: run the password interaction.
    ok(await logto('PUT', '/api/experience', { interactionEvent: 'SignIn' }), 'start experience');
    location = await passwordSteps(logto, email, password);
  }
  location = await followRedirects(logto, location, atApp);
  const callback = await app('GET', location);
  if (callback.status >= 400) throw new Error(`app callback -> ${callback.status} ${JSON.stringify(callback.data)}`);
  return { app, logto };
}

// Logto Account API call with a user access token (opaque, no resource).
export async function accountApi(accessToken, method, path, body, verificationId) {
  const res = await fetch(`${endpoint()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(verificationId ? { 'logto-verification-id': verificationId } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: parse(await res.text()) };
}

// Verification record required by sensitive Account API writes.
export const verifyPassword = async (accessToken, password) =>
  ok(await accountApi(accessToken, 'POST', '/api/verifications/password', { password }), 'verify password')
    .verificationRecordId;

export function createClient({ clientId, clientSecret, redirectUri }) {
  const issuer = `${endpoint()}/oidc`;

  const token = async (params) => {
    const res = await fetch(`${issuer}/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams(params),
    });
    return { status: res.status, data: await res.json() };
  };

  // Opens an authorization request + experience interaction in a fresh browser.
  // `finish(redirectTo)` follows the post-submit redirects and exchanges the code for tokens.
  async function begin({ scope = 'openid offline_access', resource, interactionEvent = 'SignIn' } = {}) {
    const req = browser();
    const verifier = b64url(randomBytes(32));
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope,
      state: b64url(randomBytes(8)),
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      prompt: 'consent',
      ...(resource ? { resource } : {}),
    });
    ok(await req('GET', `${issuer}/auth?${query}`), 'authorize');
    ok(await req('PUT', '/api/experience', { interactionEvent }), 'start experience');

    const finish = async (redirectTo) => {
      const location = await followRedirects(req, redirectTo, (url) => url.startsWith(redirectUri));
      const code = new URL(location).searchParams.get('code');
      const res = await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier });
      if (res.status !== 200) throw new Error(`code exchange -> ${res.status} ${JSON.stringify(res.data)}`);
      return res.data;
    };
    return { req, finish };
  }

  // Password sign-in; mfa: { totpSecret } | { backupCode }. Returns { tokens } or { error: <Logto code> }.
  async function signIn(email, password, { mfa, ...options } = {}) {
    const { req, finish } = await begin(options);
    const pw = await req('POST', '/api/experience/verification/password', { identifier: { type: 'email', value: email }, password });
    if (pw.status >= 400) return { error: pw.data?.code };
    ok(await req('POST', '/api/experience/identification', { verificationId: pw.data.verificationId }), 'identification');
    let submitted = await submit(req);
    if (submitted.status >= 400 && mfa) {
      if (mfa.totpSecret) ok(await req('POST', '/api/experience/verification/totp/verify', { code: totp(mfa.totpSecret) }), 'totp');
      if (mfa.backupCode) ok(await req('POST', '/api/experience/verification/backup-code/verify', { code: mfa.backupCode }), 'backup code');
      submitted = await submit(req);
    }
    if (submitted.status >= 400) return { error: submitted.data?.code };
    return { tokens: await finish(submitted.data.redirectTo) };
  }

  // Social sign-in via a Logto social connector. `toBrowserUrl` maps the IdP authorization URL to one
  // this process can reach. Returns { sub } or { error, relatedUser }.
  async function socialSignIn(connectorId, toBrowserUrl = (url) => url) {
    const { req, finish } = await begin();
    const redirectUri = `${endpoint()}/callback/${connectorId}`;
    const auth = ok(
      await req('POST', `/api/experience/verification/social/${connectorId}/authorization-uri`, { redirectUri, state: b64url(randomBytes(8)) }),
      'social authorization-uri'
    );
    const idp = await fetch(toBrowserUrl(auth.authorizationUri), { redirect: 'manual' });
    const callback = new URL(idp.headers.get('location'));
    ok(
      await req('POST', `/api/experience/verification/social/${connectorId}/verify`, {
        verificationId: auth.verificationId,
        connectorData: { code: callback.searchParams.get('code'), state: callback.searchParams.get('state'), redirectUri },
      }),
      'social verify'
    );
    let identified = await req('POST', '/api/experience/identification', { verificationId: auth.verificationId });
    // Same as the hosted sign-in UI when automaticAccountLinking is on: link to the related user.
    if (identified.data?.code === 'user.identity_not_exist' && identified.data?.data?.relatedUser) {
      identified = await req('POST', '/api/experience/identification', { verificationId: auth.verificationId, linkSocialIdentity: true });
    }
    if (identified.status >= 400) return { error: identified.data?.code, relatedUser: Boolean(identified.data?.data?.relatedUser) };
    const tokens = await finish(ok(await submit(req), 'submit').redirectTo);
    return { sub: decodeJwt(tokens.id_token).sub };
  }

  return { clientId, token, begin, signIn, socialSignIn };
}
