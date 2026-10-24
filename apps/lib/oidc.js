// Shared OIDC relying-party helper (openid-client v6): discovery, PKCE + state/nonce
// login, JWKS-verified callback, RP-initiated logout, resource JWT via refresh grant.
import * as client from 'openid-client';
import { createRemoteJWKSet, jwtVerify } from 'jose';

// `internalOrigin` (e.g. http://logto:3001): server-to-server calls go there, while URLs handed
// to the browser (authorize, end-session) keep the public issuer origin.
// `resource` is one indicator or a list; all are requested at login, and resourceToken() mints a
// JWT for any of them (default: the first).
export async function createOidc({ issuer, clientId, clientSecret, baseUrl, scope, resource, internalOrigin }) {
  const resources = [resource ?? []].flat();
  const publicOrigin = new URL(issuer).origin;
  const swap = (url, from, to) => (from && to && String(url).startsWith(from) ? `${to}${String(url).slice(from.length)}` : String(url));
  const toInternal = (url) => swap(url, publicOrigin, internalOrigin);
  const toPublic = (url) => swap(url, internalOrigin, publicOrigin);
  const options = issuer.startsWith('http://') ? { execute: [client.allowInsecureRequests] } : {};
  if (internalOrigin) options[client.customFetch] = (url, init) => fetch(toInternal(url), init);
  const config = await client.discovery(new URL(issuer), clientId, clientSecret, undefined, options);
  if (internalOrigin) config[client.customFetch] = options[client.customFetch];
  const redirectUri = `${baseUrl}/callback`;
  const jwks = createRemoteJWKSet(new URL(toInternal(config.serverMetadata().jwks_uri)));

  return {
    async loginUrl(session) {
      const codeVerifier = client.randomPKCECodeVerifier();
      session.oidc = { codeVerifier, state: client.randomState(), nonce: client.randomNonce() };
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope,
        state: session.oidc.state,
        nonce: session.oidc.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        ...(scope.includes('offline_access') ? { prompt: 'consent' } : {}),
      });
      for (const indicator of resources) url.searchParams.append('resource', indicator);
      return toPublic(url.href);
    },

    // Exchanges the code (PKCE + state + nonce enforced); ID token signature is
    // verified against the issuer JWKS by openid-client.
    async handleCallback(session, currentUrl) {
      const { codeVerifier, state, nonce } = session.oidc ?? {};
      const tokens = await client.authorizationCodeGrant(config, new URL(currentUrl), {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce,
      });
      session.tokens = {
        access_token: tokens.access_token,
        id_token: tokens.id_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + (tokens.expiresIn() ?? 3600) * 1000,
      };
      session.claims = tokens.claims();
      delete session.oidc;
    },

    userinfo: (session) => client.fetchUserInfo(config, session.tokens.access_token, session.claims.sub),

    // Opaque access token (userinfo / Account API), refreshed when it expires within a minute.
    async accessToken(session) {
      if (session.tokens.expires_at && session.tokens.expires_at - Date.now() > 60_000) return session.tokens.access_token;
      const tokens = await client.refreshTokenGrant(config, session.tokens.refresh_token);
      session.tokens.access_token = tokens.access_token;
      session.tokens.refresh_token = tokens.refresh_token ?? session.tokens.refresh_token;
      session.tokens.expires_at = Date.now() + (tokens.expiresIn() ?? 3600) * 1000;
      return session.tokens.access_token;
    },

    // JWT access token for an API resource via refresh grant, verified against JWKS.
    async resourceToken(session, audience = resources[0]) {
      const tokens = await client.refreshTokenGrant(config, session.tokens.refresh_token, { resource: audience });
      session.tokens.refresh_token = tokens.refresh_token ?? session.tokens.refresh_token;
      const { protectedHeader, payload } = await jwtVerify(tokens.access_token, jwks, {
        issuer: config.serverMetadata().issuer,
        audience,
      });
      return { accessToken: tokens.access_token, protectedHeader, payload };
    },

    logoutUrl(session, postLogoutRedirectUri) {
      const url = toPublic(client.buildEndSessionUrl(config, {
        post_logout_redirect_uri: postLogoutRedirectUri,
        ...(session.tokens?.id_token ? { id_token_hint: session.tokens.id_token } : { client_id: clientId }),
      }).href);
      delete session.tokens;
      delete session.claims;
      return url;
    },
  };
}
