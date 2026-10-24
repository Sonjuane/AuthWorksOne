// In-process mock OIDC IdP for Logto generic-OIDC connector checks: /authorize auto-approves the
// identity set via setIdentity(), /token issues ES256 ID tokens, /jwks serves the key.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

// `issuer` is the base URL Logto (in Docker) uses to reach this server.
export async function startMockOidc({ port, issuer }) {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'mock', alg: 'ES256', use: 'sig' };
  const codes = new Map();
  let identity;

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/authorize') {
      const code = randomBytes(12).toString('base64url');
      codes.set(code, { ...identity, nonce: url.searchParams.get('nonce'), aud: url.searchParams.get('client_id') });
      const to = new URL(url.searchParams.get('redirect_uri'));
      to.searchParams.set('code', code);
      to.searchParams.set('state', url.searchParams.get('state'));
      return send(res, 302, undefined, { location: to.href });
    }
    if (url.pathname === '/token') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const grant = codes.get(new URLSearchParams(body).get('code'));
      if (!grant) return send(res, 400, { error: 'invalid_grant' });
      const idToken = await new SignJWT({ email: grant.email, email_verified: grant.verified, ...(grant.nonce ? { nonce: grant.nonce } : {}) })
        .setProtectedHeader({ alg: 'ES256', kid: 'mock' })
        .setIssuer(issuer)
        .setAudience(grant.aud)
        .setSubject(grant.sub)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      return send(res, 200, { access_token: randomBytes(16).toString('base64url'), token_type: 'Bearer', expires_in: 300, id_token: idToken });
    }
    if (url.pathname === '/jwks') return send(res, 200, { keys: [jwk] });
    send(res, 404, { error: 'not_found' });
  });
  await new Promise((resolve) => server.listen(port, '0.0.0.0', resolve));

  return {
    issuer,
    authorizationEndpoint: `${issuer}/authorize`,
    tokenEndpoint: `${issuer}/token`,
    jwksUri: `${issuer}/jwks`,
    // { sub, email, verified } returned by the next authorization.
    setIdentity: (next) => { identity = next; },
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}
