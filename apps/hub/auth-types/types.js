// Auth type handler interface (EX-03), documentation only. Each module in an auth-types directory
// default-exports one AuthTypeHandler. Data members are described by
// apps/hub/schemas/auth-type.schema.json; function members are checked by `interfaceErrors()` in
// apps/hub/core/extension.js (registry) and by test/contract/auth-type.contract.js.
// Handlers never persist, lock, or encrypt anything; core owns that. Throw HandlerError
// (apps/hub/core/extension.js) for expected provider failures.

/**
 * @typedef {object} HandlerCtx
 * @property {object} connector   Validated connector definition (apps/hub/schemas/connector.schema.json)
 * @property {{ clientId?: string, clientSecret?: string }} client   Resolved from the definition's `env` (CN-02)
 * @property {string} baseUrl     Provider API base (fixed, or from the connection's credential fields)
 * @property {string} redirectUri Hub OAuth callback URL
 * @property {(url: string, init?: RequestInit) => Promise<Response>} http   fetch with timeout + SSRF guard
 */

/**
 * Stored (sealed) by core; never returned whole to apps.
 * @typedef {object} Credential
 * @property {string} kind              Auth type
 * @property {string} [accessToken]
 * @property {string} [refreshToken]    Never leaves the Hub (TV-05)
 * @property {string|null} [expiresAt]  ISO time the access token expires; null = no expiry
 * @property {string} [apiKey]
 * @property {string} [username]
 * @property {string} [password]
 */

/**
 * @typedef {object} AuthTypeHandler
 * @property {string} type                       e.g. 'oauth2'
 * @property {object} definitionSchema           JSON Schema for the connector's `settings`
 * @property {string[]} requiredCredentialFields credentialFields every connector of this type declares
 * @property {string[]} secretFields             Keys getCredentials() returns in `secret`
 * @property {(ctx: HandlerCtx, s: { state: string, codeChallenge?: string }) => Promise<{ redirectUrl: string }>} [authorize]
 * @property {(ctx: HandlerCtx, cb: { query: URLSearchParams, codeVerifier?: string }) => Promise<Credential>} [handleCallback]
 * @property {(ctx: HandlerCtx, input: Record<string, string>) => Promise<Credential>} [collectCredentials]
 * @property {(ctx: HandlerCtx, c: Credential) => Promise<Credential>} [refresh]
 * @property {(ctx: HandlerCtx, c: Credential) => Promise<void>} [revoke]   Idempotent
 * @property {(ctx: HandlerCtx, c: Credential) => Promise<{ ok: boolean, status: number, account?: { id: string, name?: string } }>} test
 * @property {(ctx: HandlerCtx, c: Credential) => { secret: Record<string, string>, expiresAt: string|null }} getCredentials
 *           Must not include refresh tokens.
 */

export {};
