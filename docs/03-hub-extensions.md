# Hub Extensions — Authoring Guide

Add connectors and auth types to the Connector Hub without changing Hub core (EX-02 – EX-07). Interfaces: [apps/hub/schemas/connector.schema.json](../apps/hub/schemas/connector.schema.json), [apps/hub/schemas/auth-type.schema.json](../apps/hub/schemas/auth-type.schema.json), [apps/hub/auth-types/types.js](../apps/hub/auth-types/types.js).

## 1. Add a connector (existing auth type)

1. Copy [apps/hub/connectors/_template.json](../apps/hub/connectors/_template.json) to `apps/hub/connectors/<id>.json` (no leading `_`; `_` files are not loaded).
2. Set `id` (`^[a-z0-9-]+$`), `name`, `authType` (`oauth2` | `api_key` | `app_password`).
3. `settings` (validated by the auth type's `definitionSchema`):
   - `oauth2`: `authorizeUrl`, `tokenUrl`, `scopes`, `scopeDelimiter`, `pkce`, `clientAuth` (`basic` | `body` | `query`), `authorizeParams`, `refresh.supported`, `revoke {url, method, tokenIn: body|query|path, tokenType}` (`{{token}}` in `url` for `path`).
   - `api_key`, `app_password`: none.
4. `env`: `clientId` / `clientSecret` → env var names (oauth2). Never values. Add the names to `.env.example`.
5. `credentialFields` for user-entered types: `api_key` needs `apiKey`; `app_password` needs `username` + `appPassword`.
6. `baseUrl`: `{ "fixed": "https://…" }` or `{ "fromField": "siteUrl", "pathSuffix": "/wp-json" }`.
7. `test`: a cheap authenticated read (`/me`-style), relative to `baseUrl`. Header placeholders: `{{accessToken}}` (oauth2), `{{apiKey}}`, `{{basic}}` / `{{username}}` (app_password). `accountIdPath` / `accountNamePath` are dot paths into the JSON response.
8. `auth`: `{ "header": "Authorization", "format": "Bearer {{accessToken}}" }` — returned to apps by `POST /v1/credentials`.
9. Optional: disable with `hub.connectors.<id>.enabled: false` in `config/sso.config.json` (EX-05). Connectors are enabled by default.
10. Verify: `npm run test:contract` (connector suite) and restart the Hub. Expect `connectors: [… <id>]` in the `started` log line, or `connector_skipped {id, missingEnv}` until env is set.

Test-only copies (e.g. pointed at the mock provider) go in another directory listed later in `HUB_CONNECTOR_DIRS`; a later directory replaces a definition with the same `id`.

## 2. Add an auth type

1. Copy [apps/hub/auth-types/_template.js](../apps/hub/auth-types/_template.js) to `apps/hub/auth-types/<type>.js` (or a directory in `HUB_AUTH_TYPE_DIRS`).
2. Data members: `type` (`^[a-z][a-z0-9_]*$`), `definitionSchema` (JSON Schema for `settings`), `requiredCredentialFields`, `secretFields` (subset of `accessToken`, `apiKey`, `username`, `appPassword`). A new secret field name needs an OpenAPI `Credential.secret` change first (TV-07).
3. Functions: `test` and `getCredentials` are required, plus exactly one of `authorize` + `handleCallback` (redirect flow) or `collectCredentials` (user-entered). `refresh` and `revoke` are optional; `revoke` must be idempotent.
4. Rules: no persistence, locking, or encryption (core owns them); call providers only through `ctx.http`; throw `HandlerError` from `apps/hub/core/extension.js` with `provider_denied`, `refresh_failed`, `provider_unauthorized`, `provider_unavailable`, `invalid_input`, or `refresh_not_supported`; `getCredentials` never returns a refresh token.
5. Add a contract fixture for the new `type` in [test/contract/fixtures.js](../test/contract/fixtures.js) (mock-pointed connector definition + inputs). A handler without a fixture fails the suite.
6. Verify: `npm run test:contract` — every auth type must pass every contract test (EX-06).

## 3. Contract suites (EX-06)

| Suite | File | Checks |
|---|---|---|
| Auth type | [test/contract/auth-type.contract.js](../test/contract/auth-type.contract.js) | Interface; connect round trip (redirect or collect) against the mock; credential test passes with an account id; `getCredentials` returns exactly `secretFields`, no refresh token; bad credentials fail the test; refresh + `refresh_failed` (when refreshable); revoke idempotent (+ invalidates when the provider supports it) |
| Connector | [test/contract/connector.contract.js](../test/contract/connector.contract.js) | Placeholders match the auth type's secrets; `auth` hint present; env names only (documented in `.env.example`); production endpoints use https |

The registry additionally rejects (Hub startup fails, CN-05): invalid JSON, schema violations, unknown `authType`, invalid `settings`, missing required `credentialFields`, and handler modules that break the interface.
