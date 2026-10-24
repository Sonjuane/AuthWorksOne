# AuthWorksOne

Self-hosted universal SSO on Logto (OIDC IdP). Apps integrate with only the issuer URL + client ID/secret; users sign in once and reach every registered app. Includes config-as-code provisioning, self-service profile editing, and two sample relying parties.

## Quick start (local)

```sh
cp .env.example .env            # set POSTGRES_PASSWORD
npm install
npm run up                      # Logto :3001 (issuer) + Admin Console :3002 + Postgres + dev mailbox :3099
```

Wait until `http://localhost:3001/oidc/.well-known/openid-configuration` returns 200, then complete the **one-time bootstrap** ([docs/01-runbook.md §2](docs/01-runbook.md)): create the console admin user and the Management-API M2M app, paste its credentials into `.env`.

```sh
npm run provision               # applies config/sso.config.json to Logto (idempotent)
npm run mailbox                 # dev-only: tails the mailbox container (sign-up verification codes)
npm run rp                      # sample relying party  -> http://localhost:3010
npm run profile                 # custom profile UI     -> http://localhost:3020
```

Sign up at `http://localhost:3010` (verification code prints in the mailbox log; 2FA set-up is offered and can be skipped), then open `http://localhost:3020` — you are signed in without credentials (SSO).

Connector Hub (`:3030`): set the `HUB_*` values in `.env` (see `.env.example`), then `npm run hub:db:init && npm run hub:migrate`. `npm run up` runs it in compose ([docs/01-runbook.md §4b](docs/01-runbook.md)).

Checks: `npm test` (unit + contract), `npm run test:contract` (EX-06 suites only), `npm run test:int` (live tenant + Hub database: provisioning, applied config, role claims, Hub foundation), `npm run verify:logto` (LV-01–LV-09).

## What runs where

| URL | What |
| --- | --- |
| `http://localhost:3001/oidc` | OIDC issuer (discovery, authorize, token, userinfo, JWKS) |
| `http://localhost:3001/account` | Prebuilt account center (email, username, password) |
| `http://localhost:3002` | Logto Admin Console |
| `http://localhost:3010` | Sample RP: PKCE login, ID-token/userinfo/JWT-access-token views, SSO logout |
| `http://localhost:3020` | Custom profile UI: edits name/avatar/custom fields via the Account API |
| `http://localhost:3099` | Dev mailbox container: JSON list of received emails (`npm run mailbox` tails it) |
| `http://localhost:3030` | Connector Hub: app API `/v1/connections`, `/v1/credentials`; `/login`, `/connect/start`, `/ui-api/*` (JSON for the Hub UI), `/webhooks/logto`, `/health`, `/openapi.json` (the Vue UI arrives in Phase 6) |
| `http://localhost:3097` | Mock provider (compose profile `test`): OAuth 2.0 + APIs + `/_control/*` |

## Repository map

| Path | Contents |
| --- | --- |
| [docker-compose.yml](docker-compose.yml) | Logto 1.45 + PostgreSQL 17 (127.0.0.1:5432), named volume, healthchecks; `mailbox` and `hub` services (profiles `dev`, `test`) |
| [apps/hub/](apps/hub/) | Connector Hub: `server.js`, `openapi.json` (API source of truth), `core/` (config, vault, sealed tables, connections, audit, SSRF-guarded HTTP, logger, auth, security, registry, extension helpers, manifest, db, migrations, sessions, HTTP envelope), `routes/` (login, connect, UI API), `auth-types/` + `connectors/` (extension points), `schemas/`, `migrations/`, `Dockerfile` |
| [config/sso.config.json](config/sso.config.json) | Declarative SSO config: resources + scopes, roles, role assignments, applications (+ Hub client settings), social connectors, email provider, webhooks, sign-in experience (MFA, lockout, account linking), account center, custom profile fields, JWT claims, Hub settings |
| [config/schemas/sso.config.schema.json](config/schemas/sso.config.schema.json) | JSON Schema for the config (editor validation + contract) |
| [scripts/provision.js](scripts/provision.js) | Idempotent apply of the config via Management API; writes app credentials to `.env.apps` |
| [scripts/rotate-keys.js](scripts/rotate-keys.js) | OIDC signing-key rotation + JWKS verification |
| [scripts/dev-mailbox.js](scripts/dev-mailbox.js) | Dev-only receiver for the `http-email` fallback connector |
| [scripts/verify-logto.js](scripts/verify-logto.js) | Live LV-01–LV-09 checks; restores the tenant |
| [scripts/hub-db-init.js](scripts/hub-db-init.js), [scripts/hub-migrate.js](scripts/hub-migrate.js), [scripts/hub-reencrypt.js](scripts/hub-reencrypt.js), [scripts/hub-reconcile.js](scripts/hub-reconcile.js) | Hub role/database creation, migrations, master-key re-encryption, deleted-user reconciliation |
| [scripts/lib/](scripts/lib/) | Management API client; JWT-customizer script generator; Experience API sign-in driver; mock OIDC IdP; TOTP |
| [test/](test/) | `unit/` (config schema, generated scripts, Hub core + registry + OpenAPI, repo hygiene), `contract/` (EX-06 suites), `integration/` (live tenant, Hub database), `mock-provider/` (mock OAuth/API provider), `fixtures/` |
| [apps/lib/](apps/lib/) | Shared utilities: OIDC relying-party helper (PKCE, JWKS verify, logout), access-token verifier (`jwt.js`), minimal HTTP/session/HTML helper (pluggable session store) |
| [apps/sample-rp/server.js](apps/sample-rp/server.js) | Sample third-party app (issuer + client ID/secret only) |
| [apps/profile-app/server.js](apps/profile-app/server.js) | Custom-branded profile editor against the Account API |
| [docs/01-runbook.md](docs/01-runbook.md) | Operations: bootstrap, add an app, connectors, key rotation, backup/restore, secrets, production |
| [docs/03-hub-extensions.md](docs/03-hub-extensions.md) | Authoring guide: add a Hub connector or auth type; contract suites |
| [docs/02-build-plan.md](docs/02-build-plan.md) | Build plan for the Logto extensions + Connector Hub: Phase 0 results, phases/tasks, traceability matrix, Hub design, API outline, config changes, test plan, open questions |
| [memory/](memory/) | LLM wiki (architecture, decisions, patterns, gotchas, domain) |

## Change workflows

- **Add / change an app**: edit `applications` in [config/sso.config.json](config/sso.config.json) → `npm run provision` → hand the printed client ID/secret + issuer URL to the app team. Redirect URIs are exact-match.
- **Change auth methods / branding**: edit `signInExperience` in the config → `npm run provision`.
- **Add or remap profile-field claims**: edit `customProfileFields` and `customJwtClaims.fromCustomData` → `npm run provision` (regenerates and uploads the JWT-customizer script). Claim names must be alphanumeric (Logto restriction).
- **Enable Google Workspace login**: set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env` → `npm run provision` ([docs/01-runbook.md §4](docs/01-runbook.md)).
- **Enable GitHub login**: set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` → `npm run provision`.
- **Enable real email (AWS SES)**: set `AWS_SES_*` in `.env` → `npm run provision`; the dev `http-email` fallback is removed automatically ([docs/01-runbook.md §4](docs/01-runbook.md)).
- **Assign a role by config**: put emails in the env var named by `roleAssignments[].emailsEnv` (e.g. `OWNER_EMAILS`) → `npm run provision` ([docs/01-runbook.md §4a](docs/01-runbook.md)).
- **Rotate signing keys**: `npm run rotate-keys` ([docs/01-runbook.md §5](docs/01-runbook.md)).
- **Verify Logto features (before any image upgrade)**: `npm run verify:logto` (needs `.env.apps` from provision). It runs the LV-01–LV-09 checks live and restores the tenant afterwards; any `FAIL` or `tenant CHANGED` blocks the upgrade.
- **Add a Hub connector or auth type**: new file in `apps/hub/connectors/` or `apps/hub/auth-types/` → `npm run test:contract` → restart the Hub ([docs/03-hub-extensions.md](docs/03-hub-extensions.md)).
- **Let an app use the Hub**: add a `hub` block (`allowedConnectors`, `consentReturnUris`) to its `applications[]` entry → `npm run provision` → restart the Hub. The app calls `POST /v1/credentials` with a Logto token for `https://hub.authworks.local` ([docs/01-runbook.md §4b](docs/01-runbook.md)).
- **Clean up after Hub downtime**: `npm run hub:reconcile -- --dry-run`, then without `--dry-run` (removes data of users deleted in Logto).
- **Rotate the Hub master key**: add `v2:<key>` to `HUB_MASTER_KEYS`, set `HUB_MASTER_KEY_CURRENT=v2`, `npm run hub:reencrypt` ([docs/01-runbook.md §4b](docs/01-runbook.md)).
- **Backup / restore**: [docs/01-runbook.md §6](docs/01-runbook.md).

## Verification checklist

Each item was exercised end-to-end on 2026-07-07 against Logto 1.41:

1. PKCE + state/nonce login from a generic OIDC client (`openid-client`), ID token JWKS-verified.
2. `userinfo` includes `custom_data` when the `custom_data` scope is granted.
3. JWT access token for `https://api.authworks.local` (ES384 `at+jwt`) verifies against `/oidc/jwks` and carries `displayName` / `jobTitle` claims.
4. Sign in once → second app logs in silently (SSO).
5. Profile edit via Account API → claims reflect the change on next token issuance.
6. RP-initiated logout ends the IdP session; other apps must re-authenticate.
7. Key rotation adds a new JWKS key while keeping the old one for the grace period.

## Fix-it entry points

- `invalid_client` on token exchange → re-run `npm run provision` (secrets come from Logto's `application_secrets` store, never the legacy `secret` field) and restart the app.
- Sign-up 400 `passwordless_requires_verify` → an Email connector must exist; `npm run up` (dev mailbox) or set the email provider env (`AWS_SES_*`), then `npm run provision`.
- More in [docs/01-runbook.md §8](docs/01-runbook.md).
