// Contract fixtures: one mock-pointed connector definition per auth type (keyed by `type`).
// `url` is the in-process mock provider's base URL; `control` its controls.
const bearerTest = { method: 'GET', path: '/api/me', headers: { authorization: 'Bearer {{accessToken}}' }, accountIdPath: 'id', accountNamePath: 'name' };
const bearerAuth = { header: 'Authorization', format: 'Bearer {{accessToken}}' };

export const contractFixtures = ({ url, control }) => ({
  oauth2: {
    definition: {
      id: 'mock-oauth', name: 'Mock OAuth', authType: 'oauth2',
      env: { clientId: 'MOCK_CLIENT_ID', clientSecret: 'MOCK_CLIENT_SECRET' },
      settings: {
        authorizeUrl: `${url}/oauth/authorize`, tokenUrl: `${url}/oauth/token`, scopes: ['read'], pkce: true, clientAuth: 'basic',
        refresh: { supported: true },
        revoke: { url: `${url}/oauth/revoke`, method: 'POST', tokenIn: 'body', tokenType: 'refresh_token' },
      },
      baseUrl: { fixed: url }, test: bearerTest, auth: bearerAuth,
    },
    client: { clientId: control.client.id, clientSecret: control.client.secret },
    refreshable: true,
    revokeEffective: true,
  },
  api_key: {
    definition: {
      id: 'mock-key', name: 'Mock API key', authType: 'api_key',
      credentialFields: [{ name: 'apiKey', label: 'API key', type: 'secret' }],
      baseUrl: { fixed: url },
      test: { method: 'GET', path: '/api/key/me', headers: { 'x-api-key': '{{apiKey}}' }, accountIdPath: 'id' },
      auth: { header: 'X-Api-Key', format: '{{apiKey}}' },
    },
    setup: (c) => c.addApiKey('mock-key-valid'),
    input: { apiKey: 'mock-key-valid' },
    badInput: { apiKey: 'mock-key-wrong' },
  },
  app_password: {
    definition: {
      id: 'mock-wordpress', name: 'Mock WordPress', authType: 'app_password',
      credentialFields: [
        { name: 'siteUrl', label: 'Site URL', type: 'url' },
        { name: 'username', label: 'Username', type: 'string' },
        { name: 'appPassword', label: 'Application password', type: 'secret' },
      ],
      baseUrl: { fromField: 'siteUrl', pathSuffix: '/wp-json' },
      test: { method: 'GET', path: '/wp/v2/users/me?context=edit', headers: { authorization: 'Basic {{basic}}' }, accountIdPath: 'id', accountNamePath: 'name' },
      auth: { header: 'Authorization', format: 'Basic {{basic}}' },
    },
    setup: (c) => c.addAppPassword('admin', 'abcd efgh ijkl mnop'),
    input: { siteUrl: `${url}/`, username: 'admin', appPassword: 'abcd efgh ijkl mnop' },
    badInput: { siteUrl: url, username: 'admin', appPassword: 'wrong' },
  },
  // Bearer-token auth types (EX-04 fixture, EX-07 template): the mock issues a real token.
  ...Object.fromEntries(['static_bearer', 'template_token'].map((type) => [type, {
    definition: {
      id: `mock-${type}`, name: `Mock ${type}`, authType: type,
      credentialFields: [{ name: 'token', label: 'Token', type: 'secret' }],
      baseUrl: { fixed: url }, test: bearerTest, auth: bearerAuth,
    },
    get input() { return { token: control.issueAccessToken() }; },
    badInput: { token: 'mock_at_not_issued' },
  }])),
});
