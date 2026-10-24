// Shared OIDC relying-party helper (openid-client v6): discovery, PKCE + state/nonce
// login, JWKS-verified callback, RP-initiated logout, resource JWT via refresh grant.
import * as client from 'openid-client';
import { createRemoteJWKSet, jwtVerify } from 'jose';

// `internalOrigin` (e.g. http://logto:3001): server-to-server calls go there, while URLs handed
// to the browser (authorize, end-session) keep the public issuer origin.
export async function createOidc({ issuer, clientId, clientSecret, baseUrl, scope, resource, internalOrigin }) {
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
      return toPublic(client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope,
        state: session.oidc.state,
        nonce: session.oidc.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        ...(scope.includes('offline_access') ? { prompt: 'consent' } : {}),
        ...(resource ? { resource } : {}),
      }).href);
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
      };
      session.claims = tokens.claims();
      delete session.oidc;
    },

    userinfo: (session) => client.fetchUserInfo(config, session.tokens.access_token, session.claims.sub),

    // JWT access token for an API resource via refresh grant, verified against JWKS.
    async resourceToken(session) {
      const tokens = await client.refreshTokenGrant(config, session.tokens.refresh_token, { resource });
      session.tokens.refresh_token = tokens.refresh_token ?? session.tokens.refresh_token;
      const { protectedHeader, payload } = await jwtVerify(tokens.access_token, jwks, {
        issuer: config.serverMetadata().issuer,
        audience: resource,
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
