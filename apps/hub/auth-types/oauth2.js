// OAuth 2.0 authorization-code auth type (EX-03): optional PKCE, refresh, revoke. Provider quirks
// are declarative in the connector's `settings` (client auth placement, revoke shape, extra params).
import { HandlerError, runTestRequest } from '../core/extension.js';

const definitionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['authorizeUrl', 'tokenUrl'],
  properties: {
    authorizeUrl: { type: 'string', format: 'uri' },
    tokenUrl: { type: 'string', format: 'uri' },
    scopes: { type: 'array', items: { type: 'string' }, default: [] },
    scopeDelimiter: { type: 'string', default: ' ' },
    pkce: { type: 'boolean', default: false },
    clientAuth: { enum: ['basic', 'body', 'query'], default: 'body', description: 'Where client_id/secret go on the token request' },
    authorizeParams: { type: 'object', additionalProperties: { type: 'string' } },
    refresh: {
      type: 'object',
      additionalProperties: false,
      properties: { supported: { type: 'boolean' } },
    },
    revoke: {
      type: 'object',
      additionalProperties: false,
      required: ['url', 'method', 'tokenIn', 'tokenType'],
      properties: {
        url: { type: 'string', description: 'Use {{token}} in the URL when tokenIn is "path"' },
        method: { enum: ['POST', 'DELETE'] },
        tokenIn: { enum: ['body', 'query', 'path'] },
        tokenType: { enum: ['access_token', 'refresh_token'] },
      },
    },
  },
};

const tokenRequest = async (ctx, params) => {
  const { settings } = ctx.connector;
  const { clientId, clientSecret } = ctx.client;
  const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  const body = new URLSearchParams(params);
  const url = new URL(settings.tokenUrl);
  const clientAuth = settings.clientAuth ?? 'body';
  if (clientAuth === 'basic') headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`;
  const target = clientAuth === 'query' ? url.searchParams : body;
  if (clientAuth !== 'basic') {
    target.set('client_id', clientId);
    target.set('client_secret', clientSecret);
  }
  const res = await ctx.http(url.href, { method: 'POST', headers, body });
  if (res.status >= 500) throw new HandlerError('provider_unavailable', `token endpoint -> ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

const toCredential = (data, previous = {}) => {
  if (!data.access_token) throw new HandlerError('provider_unauthorized', 'token response has no access_token');
  return {
    kind: 'oauth2',
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previous.refreshToken,
    expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null,
    tokenType: data.token_type ?? 'Bearer',
    ...(data.scope ? { scope: data.scope } : {}),
  };
};

export default {
  type: 'oauth2',
  definitionSchema,
  requiredCredentialFields: [],
  secretFields: ['accessToken'],

  async authorize(ctx, { state, codeChallenge }) {
    const { settings } = ctx.connector;
    const url = new URL(settings.authorizeUrl);
    const params = {
      response_type: 'code',
      client_id: ctx.client.clientId,
      redirect_uri: ctx.redirectUri,
      state,
      ...(settings.scopes?.length ? { scope: settings.scopes.join(settings.scopeDelimiter ?? ' ') } : {}),
      ...(settings.pkce ? { code_challenge: codeChallenge, code_challenge_method: 'S256' } : {}),
      ...settings.authorizeParams,
    };
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return { redirectUrl: url.href };
  },

  async handleCallback(ctx, { query, codeVerifier }) {
    if (query.get('error')) throw new HandlerError('provider_denied', `provider returned ${query.get('error')}`);
    const code = query.get('code');
    if (!code) throw new HandlerError('invalid_input', 'callback has no code');
    const { status, data } = await tokenRequest(ctx, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: ctx.redirectUri,
      ...(ctx.connector.settings.pkce ? { code_verifier: codeVerifier } : {}),
    });
    if (status !== 200) throw new HandlerError('provider_denied', `code exchange -> ${status} ${data.error ?? ''}`.trim());
    return toCredential(data);
  },

  async refresh(ctx, credential) {
    if (!ctx.connector.settings.refresh?.supported || !credential.refreshToken) {
      throw new HandlerError('refresh_not_supported', `${ctx.connector.id} tokens cannot be refreshed`);
    }
    const { status, data } = await tokenRequest(ctx, { grant_type: 'refresh_token', refresh_token: credential.refreshToken });
    if (status !== 200) throw new HandlerError('refresh_failed', `refresh -> ${status} ${data.error ?? ''}`.trim());
    return toCredential(data, credential);
  },

  async revoke(ctx, credential) {
    const { revoke } = ctx.connector.settings;
    if (!revoke) return;
    const token = revoke.tokenType === 'refresh_token' ? credential.refreshToken ?? credential.accessToken : credential.accessToken;
    const url = new URL(revoke.url.replace('{{token}}', encodeURIComponent(token)));
    const init = { method: revoke.method, headers: {} };
    if (revoke.tokenIn === 'query') url.searchParams.set('token', token);
    if (revoke.tokenIn === 'body') {
      init.headers['content-type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams({ token, token_type_hint: revoke.tokenType });
    }
    const res = await ctx.http(url.href, init);
    // Already-revoked or unknown tokens count as revoked (idempotent).
    if (res.status >= 500) throw new HandlerError('provider_unavailable', `revoke -> ${res.status}`);
  },

  test: (ctx, credential) => runTestRequest(ctx, credential),

  getCredentials: (ctx, credential) => ({ secret: { accessToken: credential.accessToken }, expiresAt: credential.expiresAt ?? null }),
};
