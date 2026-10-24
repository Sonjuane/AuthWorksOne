# AuthWorksOne

Self-hosted universal SSO on Logto (OIDC IdP). Apps integrate with only the issuer URL + client ID/secret; users sign in once and reach every registered app. Includes config-as-code provisioning, self-service profile editing, and two sample relying parties.

## Quick start (local)

```sh
cp .env.example .env            # set POSTGRES_PASSWORD
npm install
npm run up                      # Logto :3001 (issuer) + Admin Console :3002 + Postgres
```

Wait until `http://localhost:3001/oidc/.well-known/openid-configuration` returns 200, then complete the **one-time bootstrap** ([docs/01-runbook.md §2](docs/01-runbook.md)): create the console admin user and the Management-API M2M app, paste its credentials into `.env`.

```sh
npm run provision               # applies config/sso.config.json to Logto (idempotent)
npm run mailbox                 # dev-only: receives sign-up verification codes
npm run rp                      # sample relying party  -> http://localhost:3010
npm run profile                 # custom profile UI     -> http://localhost:3020
```

Sign up at `http://localhost:3010` (verification code prints in the mailbox terminal), then open `http://localhost:3020` — you are signed in without credentials (SSO).

## What runs where

| URL | What |
| --- | --- |
| `http://localhost:3001/oidc` | OIDC issuer (discovery, authorize, token, userinfo, JWKS) |
| `http://localhost:3001/account` | Prebuilt account center (email, username, password) |
| `http://localhost:3002` | Logto Admin Console |
| `http://localhost:3010` | Sample RP: PKCE login, ID-token/userinfo/JWT-access-token views, SSO logout |
| `http://localhost:3020` | Custom profile UI: edits name/avatar/custom fields via the Account API |
| `http://localhost:3099` | Dev mailbox (`npm run mailbox`) |

## Repository map

| Path | Contents |
| --- | --- |
| [docker-compose.yml](docker-compose.yml) | Logto 1.45 + PostgreSQL 17, named volume, healthchecks |
| [config/sso.config.json](config/sso.config.json) | Declarative SSO config: resources, applications, connectors, sign-in experience, account center, custom profile fields, JWT claim mapping |
| [config/schemas/sso.config.schema.json](config/schemas/sso.config.schema.json) | JSON Schema for the config (editor validation + contract) |
| [scripts/provision.js](scripts/provision.js) | Idempotent apply of the config via Management API; writes app credentials to `.env.apps` |
| [scripts/rotate-keys.js](scripts/rotate-keys.js) | OIDC signing-key rotation + JWKS verification |
| [scripts/dev-mailbox.js](scripts/dev-mailbox.js) | Dev-only receiver for the `http-email` fallback connector |
| [scripts/lib/](scripts/lib/) | Management API client; JWT-customizer script generator |
| [apps/lib/](apps/lib/) | Shared utilities: OIDC relying-party helper (PKCE, JWKS verify, logout), minimal HTTP/session/HTML helper |
| [apps/sample-rp/server.js](apps/sample-rp/server.js) | Sample third-party app (issuer + client ID/secret only) |
| [apps/profile-app/server.js](apps/profile-app/server.js) | Custom-branded profile editor against the Account API |
| [docs/01-runbook.md](docs/01-runbook.md) | Operations: bootstrap, add an app, connectors, key rotation, backup/restore, secrets, production |
| [docs/02-build-plan.md](docs/02-build-plan.md) | Build plan for the Logto extensions + Connector Hub: Phase 0 results, phases/tasks, traceability matrix, Hub design, API outline, config changes, test plan, open questions |
| [memory/](memory/) | LLM wiki (architecture, decisions, patterns, gotchas, domain) |

## Change workflows

- **Add / change an app**: edit `applications` in [config/sso.config.json](config/sso.config.json) → `npm run provision` → hand the printed client ID/secret + issuer URL to the app team. Redirect URIs are exact-match.
- **Change auth methods / branding**: edit `signInExperience` in the config → `npm run provision`.
- **Add or remap profile-field claims**: edit `customProfileFields` and `customJwtClaims.fromCustomData` → `npm run provision` (regenerates and uploads the JWT-customizer script). Claim names must be alphanumeric (Logto restriction).
- **Enable Google Workspace login**: set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env` → `npm run provision` ([docs/01-runbook.md §4](docs/01-runbook.md)).
- **Enable real email (SMTP)**: set `SMTP_*` in `.env` → `npm run provision`; the dev `http-email` fallback connector is removed automatically.
- **Rotate signing keys**: `npm run rotate-keys` ([docs/01-runbook.md §5](docs/01-runbook.md)).
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
- Sign-up 400 `passwordless_requires_verify` → an Email connector must exist; start `npm run mailbox` (dev) or set `SMTP_*`, then `npm run provision`.
- More in [docs/01-runbook.md §8](docs/01-runbook.md).
