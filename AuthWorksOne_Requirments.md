# Auth Works One — Requirements

**Summary:** AuthWorksOne is a single sign-on platform for a family of custom apps, made of two parts. **Logto** (self-hosted, already set up in this repo) is the identity provider: Google, GitHub, and email/password login, 2FA, roles, and SSO. The **Connector Hub** is a new custom Node.js service where users connect third-party accounts (ClickUp, HubSpot, WordPress, Google). It stores those credentials encrypted, and registered apps can get short-lived credentials after the user consents.

---

## 1. Decisions

| Area | Decision |
| --- | --- |
| System shape | Two services. **Logto** handles identity (OIDC provider). The **Connector Hub** handles the connector vault, consent, and token API, and trusts Logto-issued JWTs. |
| Identity core | Logto OSS, Docker image `svhd/logto:1.45` (upgraded from 1.41 on 2026-10-24). Configured as code via `config/sso.config.json` plus `npm run provision`. Upgrades are deliberate, and only when a Section 3.0 verification item requires one. |
| Tenancy | Single-tenant in v1. Logto Organizations are the planned multi-tenant path. Hub tables carry `tenant_id` from day one. |
| Connector data access | Token vault. An app requests short-lived provider credentials from the Hub, then calls the provider itself. |
| Connection ownership | Connections belong to the user. Each client app needs the user's consent per connection. |
| Connector OAuth | The Hub runs all connector OAuth flows with its own provider OAuth clients. Logto's Secret Vault is **not** used: it supports one identity per provider per user, has no per-app consent, and has no API key or app password types. |
| Architecture | Modular. Login providers, MFA, and email are Logto connectors and features, configured as code. Hub connectors and auth types are Hub modules behind defined interfaces (Section 3.11). |
| Connector definitions | Declarative schema-validated file per connector. New connectors need no new code where possible. |
| Connector credential types | OAuth2 (with refresh), API key, username + app password. |
| 2FA | Logto TOTP plus backup codes. |
| Account linking | Logto automatic account linking, by verified email only. |
| RBAC | Logto roles (global) plus API resource permissions (per app), emitted in tokens. |
| SSO | Logto session. Logging into one app gives silent login to the others. |
| Internal apps | Registered as Logto API resources. They validate Logto JWTs via JWKS. No connect step. |
| Hub stack | Node.js (JavaScript, ESM) + PostgreSQL (separate database on the existing Postgres container). Hub UI in Vue 3 + Tailwind. |
| UI split | Logto: hosted sign-in (white-labeled), Account Center (security settings), Admin Console (users, roles, apps). Hub UI: connections, consent, profile, Hub admin. |
| Email | Logto email connector. AWS SES (official connector) or Cloudflare (via Logto's HTTP email connector and a relay), chosen by config. Dev uses the existing `http-email` connector and `scripts/dev-mailbox.js`. |
| Hosting | Docker Compose on a VPS behind a TLS reverse proxy. |
| Compliance | No formal target in v1. |
| Scale (v1) | Under 1,000 users and under 10 client apps. A single instance of each service. |
| Validation | Full test pyramid: unit, integration with mock providers, E2E browser, live smoke test per connector. |

---

## 2. Terms

- **Primary account:** The user's Logto identity (`sub`).
- **Client app:** An app registered in Logto (an OIDC relying party).
- **Hub resource:** The Logto API resource representing the Hub (indicator `https://hub.authworks.local`, configurable). Client apps request access tokens for it.
- **Connector:** A Hub definition of a third-party service and how to authenticate to it.
- **Connection:** One user's stored credential for a connector instance (e.g. "My HubSpot portal", "client-site.com WordPress").
- **Consent grant:** A user's permission for one client app (`client_id`) to use one connection.

---

## 3. Functional Requirements

### 3.0 Logto Verification (Phase 0 — do first)

Before planning dependent work, verify each item against the running Logto container (verified on 1.41 and 1.45). Record each result in `memory/gotchas.md`.

- **LV-01:** Automatic account linking by verified email works for Google + GitHub + email/password (ID-03).
- **LV-02:** TOTP + backup codes can be enabled via the Management API, and users can enroll from the sign-in flow or Account Center.
- **LV-03:** Available MFA policies (user-controlled, mandatory). Check whether enforcement per role or per organization is possible.
- **LV-04:** Users can list and revoke their own sessions (Account Center or Account API).
- **LV-05:** Built-in failed-sign-in lockout (if present) can be enabled by config.
- **LV-06:** Which event types Logto's audit logs record, and whether the Management API can query them.
- **LV-07:** Refresh token rotation and lifetime are configurable per application.
- **LV-08:** Access tokens for the Hub resource carry `sub`, `client_id`, `scope`, and custom claims (roles).
- **LV-09:** The AWS SES connector and the HTTP email connector both work for verification and reset emails.

**Rule:** If an item fails, either upgrade Logto (if a newer version provides it; record the decision in `memory/decisions.md`) or move the dependent requirement to Section 7. Never build a custom replacement for a Logto feature without user approval.

### 3.1 Identity — Logto Configuration (ID)

All identity requirements are met through Logto and applied as code (`config/sso.config.json` → `npm run provision`). No manual Console changes except the one-time bootstrap.

- **ID-01:** Sign-in methods: Google, GitHub, email + password. The GitHub connector is added to config, with secrets from env.
- **ID-02:** Email verification is required at sign-up. Password reset works via email code.
- **ID-03:** Automatic account linking by verified email is enabled (LV-01).
- **ID-04:** TOTP + backup codes are enabled. Users can enroll and remove 2FA (LV-02).
- **ID-05:** MFA policy is set per LV-03 results. Per-role enforcement only if natively supported.
- **ID-06:** Profile fields `displayName` and `jobTitle` (existing custom fields) plus avatar and timezone.
- **ID-07:** Global roles `owner`, `admin`, `user` are defined in config and emitted in tokens via the existing JWT customizer pattern (`customJwtClaims`).
- **ID-08:** Per-app permissions are defined as API resource scopes in config and assigned through roles.
- **ID-09:** Applications are declared in config with exact redirect URIs (no wildcards), post-logout URIs, PKCE for public clients, and refresh token rotation (LV-07).
- **ID-10:** Signing keys rotate with `npm run rotate-keys` without downtime.
- **ID-11:** Sign-in page branding (logo, colors, custom CSS) is set in config.
- **ID-12:** The first owner is bootstrapped through the documented one-time Console step (`docs/01-runbook.md` §2).

### 3.2 Hub — Authentication of Callers (HA)

- **HA-01:** Client apps call the Hub API with a Logto access token issued for the Hub resource. The Hub verifies it via the Logto JWKS (issuer, audience, expiry, signature).
- **HA-02:** The Hub identifies the user from `sub` and the calling app from `client_id`.
- **HA-03:** Hub API scopes: `connections:read` (list) and `connections:token` (get credentials). Requests without the required scope are rejected.
- **HA-04:** The Hub UI is itself a Logto client app (confidential) and uses the existing `apps/lib/oidc.js` helper.
- **HA-05:** Per-client settings live in config, keyed by Logto application ID: `allowedConnectors` and `consentReturnUris`. Calls from client IDs not in config are rejected (`client_not_registered`).

### 3.3 Connectors (CN)

- **CN-01:** Each connector is defined in a schema-validated file declaring: `id`, `name`, `authType` (`oauth2` | `api_key` | `app_password`), endpoints (authorize, token, revoke), scopes, PKCE support, refresh behavior, credential fields, `baseUrl` (fixed or per-connection), and a credential test request (e.g. a `/me` call).
- **CN-02:** Provider client IDs and secrets come from env via `configEnv` indirection (existing pattern). They never appear in connector files. A connector with missing env is skipped with a log line.
- **CN-03:** v1 connectors:
  - ClickUp: `oauth2`
  - HubSpot: `oauth2` with refresh
  - WordPress (self-hosted): `app_password` (site URL + username + application password)
  - Google (Drive, Calendar): `oauth2` with offline access and refresh. This uses a separate Google OAuth client and consent from Google login (ID-01).
- **CN-04:** Adding a connector with an existing `authType` requires only a new definition file plus env credentials. No code changes.
- **CN-05:** Invalid connector definitions fail Hub startup with a clear validation error.

### 3.4 Connections & Vault (VA)

- **VA-01:** A user can create multiple connections per connector, each with a label.
- **VA-02:** Encrypt all connection credentials at rest with AES-256-GCM envelope encryption. The master key comes from env. Store a key version with each record, and provide a re-encrypt command for rotation.
- **VA-03:** On connect, run the connector's credential test request. Store the connection only if it passes.
- **VA-04:** Connection states: `active`, `needs_reauth`, `revoked`, `error`. A failed refresh or a provider 401 sets `needs_reauth`.
- **VA-05:** OAuth2 tokens are refreshed on demand when within 5 minutes of expiry, with a single refresh per connection (no races).
- **VA-06:** On disconnect, call the provider's revoke endpoint where available, then delete the credentials.
- **VA-07:** Credentials, tokens, and secrets never appear in logs, errors, or audit entries.
- **VA-08:** When a Logto user is deleted, their connections and consents are deleted. The Hub learns of deletions via a Logto webhook (`User.Deleted`).

### 3.5 Consent & Token API (TV)

- **TV-01:** A client app can use a connection only after the user grants consent (per `client_id`, per connection).
- **TV-02:** The consent page (Hub UI) shows the app name, connector, and connection label. It returns the user only to a URI in that client's `consentReturnUris` (no open redirect).
- **TV-03:** Users can view and revoke consent grants in the Hub UI.
- **TV-04:** `GET` endpoint: list the connections the user has consented to for the calling app.
- **TV-05:** `POST` endpoint: get credentials for one connection. It returns a provider access token (or API key / app password), expiry, and `baseUrl`. **Provider refresh tokens are never returned.**
- **TV-06:** Stable error codes: `consent_required` (with consent URL), `connection_reauth_required` (with reconnect URL), `connection_not_found`, `connector_not_allowed_for_client`, `client_not_registered`.
- **TV-07:** Define the API schema-first (OpenAPI) before implementation, per [.agents.md/05-schema-first-api-design.md](.agents.md/05-schema-first-api-design.md).

### 3.6 Internal Apps (IA)

- **IA-01:** Internal apps are declared as Logto API resources in config. Client apps request tokens with that resource indicator.
- **IA-02:** Internal apps validate Logto JWTs via JWKS (pattern in `apps/lib/oidc.js` `resourceToken`) and read roles/permissions from claims.
- **IA-03:** Internal apps need no Hub connection.

### 3.7 Audit (AU)

- **AU-01:** Identity events (logins, 2FA changes, linking) come from Logto's audit log (LV-06).
- **AU-02:** The Hub keeps an append-only audit log of connection create/refresh-failure/delete, consent grant/revoke, credential issuance, and rejected API calls.
- **AU-03:** Each Hub entry records timestamp, `sub`, `client_id`, connection, IP, user agent, event type, and result.
- **AU-04:** The Hub admin view lists Hub audit entries with filters for user, event type, client, and date range.

### 3.8 Email (EM)

- **EM-01:** Logto sends all identity emails through one configured email connector (AWS SES or Cloudflare via HTTP relay). Selected in config.
- **EM-02:** Dev/test keeps the existing `devFallback` `http-email` connector plus `scripts/dev-mailbox.js`. E2E tests read codes from the dev mailbox.
- **EM-03:** Email templates (sign-in, register, forgot password, generic) are defined in config.

### 3.9 Hub UI (UI)

- **UI-01:** Account area: profile (name, avatar, `displayName`, `jobTitle`, timezone via the Logto Account API), a link to Logto Account Center for security settings (email, password, 2FA, social links, sessions per LV-04).
- **UI-02:** Connections: add, relabel, reconnect, delete, and status per connection.
- **UI-03:** App access: consent grants per app, with revoke.
- **UI-04:** Consent page (TV-02).
- **UI-05:** Hub admin (users with the global `owner` or `admin` role): connector status (loaded definitions, env present), client settings (HA-05, read-only from config), Hub audit log.
- **UI-06:** Vue 3 + Tailwind, responsive at phone width, visually matching the Logto sign-in branding.

### 3.10 Admin (AD)

- **AD-01:** User, role, and application management happens in the Logto Admin Console. In v1, only the owner has Console access.
- **AD-02:** Configuration changes go into `config/sso.config.json` and are applied with `npm run provision`. Console edits that provision would overwrite are forbidden.

### 3.11 Modularity & Extensibility (EX)

- **EX-01:** New login providers are added as Logto connectors in config. Standard OIDC/OAuth2 providers use Logto's generic connectors (config plus env only). Non-standard ones use Logto's connector kit.
- **EX-02:** The Hub core never imports provider-specific code. Hub modules register through a registry loaded at startup.
- **EX-03:** Hub extension points, each with a documented interface (JSDoc types plus JSON Schema):
  - **Auth type handler:** `authorize`, `handleCallback`/`collectCredentials`, `refresh`, `revoke`, `test`, `getCredentials`. v1: `oauth2`, `api_key`, `app_password`.
  - **Connector definition:** declarative file (CN-01) bound to an auth type handler.
- **EX-04:** A new auth type (e.g. OAuth1, service account / JWT bearer) is added as a new handler module, with no core or existing connector changes.
- **EX-05:** Connectors are enabled or disabled by config. Disabled connectors do not appear in the UI or API.
- **EX-06:** Each Hub extension point has a shared contract test suite. Every module must pass it.
- **EX-07:** Each Hub extension point has a short authoring guide plus a template module.

---

## 4. Non-Functional Requirements (NF)

- **NF-01:** JavaScript (ESM) on Node.js LTS. Every Hub dependency is justified in the plan. Keep the existing minimal-dependency approach (`openid-client`, `jose`, Node built-ins).
- **NF-02:** The Hub uses its own Postgres database and role on the existing Postgres container. Hub sessions are stored in Postgres.
- **NF-03:** Every Hub table carries `tenant_id`. v1 uses one default tenant.
- **NF-04:** Docker Compose runs Logto, Postgres, the Hub, a mock OAuth provider (test profile), and the dev mailbox. Production Dockerfile for the Hub. All env vars are documented in `.env.example`.
- **NF-05:** Secrets live only in git-ignored env files (existing invariant). The Hub refuses to start if required secrets are missing.
- **NF-06:** HTTPS only in production. Security headers (CSP, HSTS, frame-ancestors) and CSRF protection on Hub UI form posts.
- **NF-07:** No in-process state that would block running multiple Hub instances later (e.g. refresh locks use Postgres advisory locks).
- **NF-08:** Hub database migrations are versioned and run by command.
- **NF-09:** Hub logs are structured JSON with secrets redacted.
- **NF-10:** Provisioning stays idempotent (`+` / `=` / `-` logging). Every new Logto config section is added to `provision.js` and the config schema.

---

## 5. Existing Assets

| Asset | Action |
| --- | --- |
| `docker-compose.yml` (Logto + Postgres) | Keep. Add the Hub, mock OAuth provider, and dev mailbox services. |
| `config/sso.config.json` + schema | Keep. Add the GitHub connector, roles, Hub resource, per-client Hub settings, MFA, and account linking. |
| `scripts/provision.js`, `scripts/lib/logto.js`, `scripts/lib/jwt-script.js` | Keep. Extend for the new config sections. |
| `scripts/rotate-keys.js` | Keep (ID-10). |
| `scripts/dev-mailbox.js` | Keep (EM-02). |
| `apps/lib/oidc.js`, `apps/lib/web.js` | Keep. Used by the Hub UI login and the reference client app. |
| `apps/sample-rp` | Evolve into the reference client app (Deliverable 3). |
| `apps/profile-app` | Fold its profile editing into the Hub UI account area (UI-01), then remove it. |
| `memory/*.md`, `docs/01-runbook.md` | Keep and update as the system changes. |

---

## 6. Deliverables

1. Extended Logto config-as-code (Section 3.1) and Phase 0 verification results (Section 3.0).
2. Connector Hub service: API, vault, consent, Hub UI, Hub admin.
3. **Reference client app** (from `apps/sample-rp`): logs in via Logto, shows roles, lists consented connections, and fetches one record from each connector.
4. Connector definition files for ClickUp, HubSpot, WordPress, and Google.
5. OpenAPI spec for the Hub API.
6. Hub extension point interfaces, contract test suites, and template modules (EX-03, EX-06, EX-07).
7. Test suites per Section 7.

---

## 7. Validation & Acceptance Criteria

### 7.1 Test Layers

- **Unit:** Hub encryption/decryption and key versioning, connector schema validation, auth type handlers, consent logic, JWT verification, config schema validation.
- **Integration:** The Hub against a local mock OAuth2 provider (refresh, refresh failure, revoke, expired token), plus provisioning idempotency (run twice; the second run makes no changes).
- **E2E (Playwright):** Full browser flows against Docker Compose (real Logto container), using the reference client app. For tests, Google and GitHub login are replaced with Logto generic OIDC connectors pointed at the mock provider.
- **Live smoke:** One test per connector against real provider accounts. Skipped automatically when credentials are absent.

### 7.2 Acceptance Scenarios (all must pass)

1. A user signs up with email/password, verifies via the dev mailbox code, enrolls TOTP, logs out, and logs back in with password + TOTP.
2. A user signs in with mock "Google", then mock "GitHub" with the same verified email. Both resolve to one Logto user (ID-03).
3. A user logs into the reference app. Opening the Hub UI logs them in silently (SSO).
4. A user connects HubSpot (mock) and a WordPress site (mock) in the Hub UI. Both show `active`.
5. The reference app requests HubSpot credentials, gets `consent_required`, the user consents, and the app receives an access token and fetches data.
6. A second registered client app requests the same connection and gets `consent_required` (TV-01).
7. The mock provider expires the token. The next request refreshes transparently. The mock then rejects the refresh. The connection becomes `needs_reauth`, and the API returns `connection_reauth_required`.
8. The user revokes the reference app's consent. Its next credential request fails.
9. An admin assigns a role via config/provision. The next access token contains it.
10. A request with a token for another audience, an expired token, or a token missing `connections:token` is rejected.
11. A client ID not listed in Hub config gets `client_not_registered`. A consent return URI not in `consentReturnUris` is refused.
12. Reading the Hub database directly shows no plaintext tokens, API keys, or app passwords.
13. A log scan during the full test run finds no tokens or secrets.
14. No Hub API response contains a provider refresh token.
15. Deleting the user in Logto removes their Hub connections and consents (VA-08).
16. Every Hub event in AU-02 produced during the scenarios appears in the Hub audit log.
17. Adding a new `oauth2` connector definition (pointed at the mock) works end to end with no code changes (CN-04).
18. Adding a new generic OIDC login provider in config (pointed at the mock) and running provision shows it on the sign-in page and logs a user in (EX-01).
19. All Hub modules pass their contract test suites (EX-06).
20. Running `npm run provision` twice in a row: the second run reports no creates.

---

## 8. Out of Scope for v1 (Planned Later)

- Breached-password check (HaveIBeenPwned)
- User data export (account deletion is covered by VA-08)
- Passkeys/WebAuthn, SMS or email OTP
- Multi-tenant operation (Logto Organizations; Hub is `tenant_id`-ready)
- Proxy mode and scheduled data sync for connectors
- WordPress.com OAuth (self-hosted app passwords only)
- Formal compliance (SOC 2, HIPAA)
- Any requirement moved here by a failed Section 3.0 verification item:
  - **AU-01 (part):** Audit entries for 2FA, profile, and social-link changes made in Logto Account Center or the Account API. Logto 1.41 and 1.45 do not audit-log these (LV-06). Sign-in-flow logins, 2FA binding, and account linking stay in AU-01.

---

## 9. Assumptions

- Multiple connections per connector per user are allowed (VA-01).
- Google login (Logto) and the Google connector (Hub) use separate OAuth clients and consents.
- `apps/profile-app` is retired once its function moves into the Hub UI.
- The Hub UI is the user's main account page. Logto Account Center is linked from it for security settings.
