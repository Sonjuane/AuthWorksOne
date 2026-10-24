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

// Minimal browser: cookie jar, no automatic redirects, JSON in/out. Relative URLs resolve to Logto.
export function browser() {
  const jar = new Map();
  return async (method, url, body) => {
    const res = await fetch(new URL(url, endpoint()), {
      method,
      redirect: 'manual',
      headers: {
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
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
      let location = new URL(redirectTo, endpoint()).href;
      for (let i = 0; i < 10 && !location.startsWith(redirectUri); i++) {
        if (new URL(location).pathname.startsWith('/consent')) {
          location = new URL(ok(await req('POST', '/api/interaction/consent', {}), 'consent').redirectTo, endpoint()).href;
          continue;
        }
        const res = await req('GET', location);
        if (!res.location) throw new Error(`redirect chain stopped at ${location} (${res.status})`);
        location = new URL(res.location, location).href;
      }
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
    let submit = await req('POST', '/api/experience/submit');
    if (submit.status >= 400 && mfa) {
      if (mfa.totpSecret) ok(await req('POST', '/api/experience/verification/totp/verify', { code: totp(mfa.totpSecret) }), 'totp');
      if (mfa.backupCode) ok(await req('POST', '/api/experience/verification/backup-code/verify', { code: mfa.backupCode }), 'backup code');
      submit = await req('POST', '/api/experience/submit');
    }
    if (submit.status >= 400) return { error: submit.data?.code };
    return { tokens: await finish(submit.data.redirectTo) };
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
    const tokens = await finish(ok(await req('POST', '/api/experience/submit'), 'submit').redirectTo);
    return { sub: decodeJwt(tokens.id_token).sub };
  }

  return { clientId, token, begin, signIn, socialSignIn };
}
