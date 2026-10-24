---
type: architecture-reference
title: Architecture
description: System design, structure, and invariants for this project.
last_updated: 2026-10-24
---

# Architecture

## Components

- **Logto 1.45 (Docker)** — OIDC IdP. Issuer `$LOGTO_ENDPOINT/oidc` (:3001), Admin Console :3002, PostgreSQL 17 with `pgdata` volume. Compose: `docker-compose.yml`.
- **Config-as-code** — `config/sso.config.json` (validated by `config/schemas/sso.config.schema.json`) is the single source of truth for resources, applications, connectors, sign-in experience, account center, custom profile fields, and JWT claim mapping. `scripts/provision.js` applies it idempotently via the Management API using an M2M client (`scripts/lib/logto.js`).
- **Reference client app (Phase 7)** — `apps/sample-rp` (:3010; `APP_KEY=second-client` → :3011). Views: roles and permissions (from the resource JWT), and `/connections` + `/record`. These call `GET /v1/connections` and `POST /v1/credentials`, redirect to `consentUrl`/`reconnectUrl`, and fetch one record per connector using `baseUrl` + the `auth` hint. `HUB_URL` overrides the Hub base URL. It is a Node server built on shared `apps/lib/oidc.js` (openid-client wrapper: PKCE, state/nonce, JWKS verify, refresh-grant resource tokens, opaque-token refresh, RP-initiated logout, `internalOrigin`) and `apps/lib/web.js` (router + pluggable cookie sessions + HTML/JSON). The former `apps/profile-app` was retired in Phase 6; profile editing now lives in the Hub UI Account page.
- **Hub UI (Phase 6)** — Vue 3 + Tailwind v4 source in `apps/hub/ui`, built by Vite to `apps/hub/ui/dist` and served by the Hub. Any GET outside `/v1/`, `/ui-api/`, `/webhooks/`, `/connect/` gets the SPA (`core/static.js`). It talks only to `/ui-api/*` (session + CSRF) and uses a minimal history router (`ui/src/router.js`). Views: Connections, App access, Account, Admin, Consent.
- **Dev mailbox** — `scripts/dev-mailbox.js` runs as the compose `mailbox` service (profiles `dev`, `test`; :3099). It receives the `http-email` dev-fallback connector's POSTs at `http://mailbox:3099/email`, so email sign-up works without a real provider.
- **E2E test stack (Phase 8)** — compose project `authworks-test` (`docker-compose.yml` + overlay `docker-compose.test.yml`, `.env.test` / `.env.test.apps`). It runs on the dev ports, so only one stack runs at a time. Adds `mock-provider` (OAuth AS, record APIs, `/oidc` login IdP), plus `sample-rp` / `second-client` as compose services (they mount the repo read-only and use `LOGTO_INTERNAL_ENDPOINT` + `HUB_URL=http://hub:3030`). Playwright (`playwright.config.js`, `test/e2e/`) drives it from the host.
- **Connector Hub (`apps/hub`, :3030)** — Node ESM service on its own `hub` database/role in the shared Postgres. `core/` is provider-agnostic: config (env + `sso.config.json` `applications[].hub` resolved to client IDs via `.env.apps`), vault (envelope AES-256-GCM, versioned KEKs), JSON logger with redaction, JWT caller auth (`apps/lib/jwt.js`), Postgres session store (sealed), migrations runner, HTTP envelope. It runs in compose (reaching `postgres:5432` and `http://logto:3001` for JWKS) or on the host (`npm run hub`).
- **Hub extension points (Phase 3)** — The registry (`core/registry.js`) loads auth type handlers (`apps/hub/auth-types/*.js`, plus `HUB_AUTH_TYPE_DIRS`) and connector definitions (`apps/hub/connectors/*.json`, plus `HUB_CONNECTOR_DIRS`, where later directories override by id) at startup. It validates them against `apps/hub/schemas/*` and each handler's `definitionSchema`, and binds each connector to its handler. v1 auth types are `oauth2`, `api_key`, `app_password`; v1 connectors are clickup, hubspot, google, wordpress. The API contract is `apps/hub/openapi.json`; `/v1/manifest` is generated from it.
- **Hub connections (Phase 4)** — `core/connections.js` owns the lifecycle:
  - **Connect:** OAuth start/callback, with state in `oauth_states` (sealed PKCE verifier, single-use, user-bound, 10 min), or form input.
  - **Test, then store:** the credential test runs first, then the secret is sealed into `connection_secrets`.
  - **Refresh:** `issue()` refreshes within 5 minutes of expiry under `pg_advisory_xact_lock(tenant:connection)`. A rejected refresh sets `needs_reauth`; `remove()` revokes at the provider, then deletes.
  - **Routes:** `routes/auth.js` (Hub UI Logto login), `routes/connect.js` (browser OAuth legs), and `routes/ui-api.js` (session JSON API; CSRF on writes).
  - **Outbound HTTP:** all provider calls go through `core/http-client.js` (SSRF guard).
- **Hub consent, API, deletion (Phase 5)**:
  - `core/consent.js`: grants per (user, client_id, connection), exact-match return URIs, consent-page data.
  - `routes/api.js`: `/v1/connections`, `/v1/credentials`, validated against `openapi.json` via `core/schema.js`; rejections audited as `api.reject`.
  - `routes/webhooks.js`: Logto `User.Deleted` with HMAC check.
  - `core/users.js`: `purgeUser` and `findOrphans`, shared by the webhook and `scripts/hub-reconcile.js`.
- **Identity config (Phase 1)** — global roles `owner`/`admin`/`user` (`user` default) grant API resource scopes. The Hub resource is `https://hub.authworks.local` (`connections:read`, `connections:token`). The generated JWT customizer emits `roles` plus mapped customData. MFA is TOTP + backup codes, `PromptAtSignInAndSignUp`. The `User.Deleted` webhook targets the Hub (disabled until the Hub exists).

## Invariants

- Apps never read Logto Admin state directly; everything flows through `sso.config.json` → `npm run provision`.
- Client credentials live only in `.env.apps` (generated, git-ignored); human-managed secrets only in `.env` (git-ignored).
- Custom claim keys are declared once (`customJwtClaims.fromCustomData`); the JWT-customizer script is generated from them (`scripts/lib/jwt-script.js`) — never hand-edited in the Console.
- Access tokens for API resources are JWTs (ES384 `at+jwt`) verified against `/oidc/jwks`; the default no-resource access token is opaque and is what the Account API and `userinfo` accept.
- Hub secrets at rest are only `sealed` vault blobs bound to their row by AAD `tenant|table|id`. Session IDs and OAuth `state` values are stored as sha256 hashes.
- The Hub refuses to start on missing secrets, pending migrations, or a non-https base URL in production. Every Hub API response uses the `{ meta, data | error }` envelope.
