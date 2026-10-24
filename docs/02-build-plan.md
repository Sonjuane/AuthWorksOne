# Build Plan — Logto Extensions + Connector Hub

**Summary:** Ordered, individually shippable phases for building and validating the system in `AuthWorksOne_Requirments.md`. Each task lists the requirement IDs it covers, the files it touches, and a "done" check. Phase 0 is complete; its results are in [memory/gotchas.md](../memory/gotchas.md), and the resulting decisions are in [memory/decisions.md](../memory/decisions.md).

Baseline: git `main` @ `8a097b1`, Logto image `svhd/logto:1.45` (core `1.45.0`; upgraded from 1.41.0 on 2026-10-24).

---

## 0. Phase 0 — Logto verification results (spec §3.0)

Run 2026-10-23 on 1.41.0 and re-run 2026-10-24 on 1.45.0 (identical results) with live probes (Management, Experience, and Account APIs, plus a mock OIDC IdP). Every change was reverted and every created entity deleted.

| ID | Result | Config surface used by later phases | Dependent reqs |
|---|---|---|---|
| LV-01 | PASS | `signInExperience.socialSignIn.automaticAccountLinking` | ID-03 |
| LV-02 | PASS | `signInExperience.mfa.factors: ["Totp","BackupCode"]`; Account API `/my-account/mfa-verifications` (scope `identities`) | ID-04 |
| LV-03 | PASS (partial) | `mfa.policy` ∈ `Mandatory`, `PromptAtSignInAndSignUp`, `PromptOnlyAtSignIn`, `NoPrompt`. Per-org yes; **per-role no** | ID-05 → global `PromptAtSignInAndSignUp` (decision) |
| LV-04 | PASS | `accountCenter.fields.session`; scope `urn:logto:scope:sessions` | UI-01 |
| LV-05 | PASS | `signInExperience.sentinelPolicy {maxAttempts, lockoutDuration}` | — |
| LV-06 | PASS (gap) | `GET /api/logs` (`userId`, `logKey`, `page_size` ≤ 100). Account API changes not logged | AU-01 → partly moved to spec §8 (decision) |
| LV-07 | PASS | `customClientMetadata.rotateRefreshToken`, `refreshTokenTtlInDays` | ID-09 |
| LV-08 | PASS | `sub`, `client_id`, `scope`, `aud` native; `roles` via JWT customizer `context.user.roles` | ID-07, HA-02, HA-03 |
| LV-09 | PASS (http-email) / **PENDING (SES)** | `http-email` Register + ForgotPassword delivered; reset needs `forgotPasswordMethods` | EM-01 SES path **conditional** on task 0.3 |

No Logto upgrade is required. Remaining Phase 0 work: task 0.3.

---

## 1. Phases and tasks

Legend: **Reqs** = spec IDs satisfied; **S#** = spec §7.2 acceptance scenario.

### Phase 0 — Verification (finish)

| Task | Reqs | Files | Done check |
|---|---|---|---|
| 0.1 Record LV results | LV-01…09 | `memory/gotchas.md`, `memory/decisions.md`, spec §8 | **Done** (table above) |
| 0.2 Re-runnable verifier: port the Phase 0 probes; snapshot → probe → restore; mock OIDC IdP in-process | LV-01…09 | `scripts/verify-logto.js`, `scripts/lib/{experience,mock-oidc,totp}.js`, `package.json` (`verify:logto`), `.env.example` | **Done** 2026-10-24 on 1.45.0: `PASS` ×9 (LV-09 SES `skip`), exit 0, tenant unchanged. Run it before any image upgrade; `-- --only LV-02,LV-09` runs a subset. |
| 0.3 SES live send | LV-09, EM-01 | none (env only) | With `AWS_SES_*` and `SES_TEST_RECIPIENT` set, `npm run verify:logto -- --only LV-09` reports `ses: test email sent` and the message arrives. Until then, EM-01 SES is conditional. |

### Phase 1 — Logto config-as-code (Deliverable 1)

| Task | Reqs | Files | Done check |
|---|---|---|---|
| 1.1 Resource scopes + global roles (`owner`, `admin`, `user` default) with per-resource permissions; Hub resource `https://hub.authworks.local` with `connections:read`, `connections:token` | ID-07, ID-08, HA-03, IA-01, NF-10 | `config/sso.config.json`, `config/schemas/sso.config.schema.json`, `scripts/provision.js` | First run `+` per scope/role; second run `=` only. `GET /api/roles` shows 3 roles with permissions; `user.isDefault = true`. |
| 1.2 `roles` claim: extend generator with `customJwtClaims.roles` | ID-07, LV-08 | `scripts/lib/jwt-script.js`, `scripts/provision.js`, config + schema | `POST /api/configs/jwt-customizer/test` with sample context returns `roles`; resource JWT for a `user` contains `"roles":["user"]`. |
| 1.3 Sign-in experience: `forgotPasswordMethods`, `socialSignIn.automaticAccountLinking`, `mfa` (`Totp`, `BackupCode`, `PromptAtSignInAndSignUp`), `sentinelPolicy`, GitHub target | ID-02, ID-03, ID-04, ID-05, LV-05 | config + schema | `GET /api/sign-in-exp` matches config; `verify:logto` LV-01/02/03/05 PASS. |
| 1.4 GitHub login connector (`github-universal`, `configEnv`) | ID-01, EX-01 | config, `.env.example`, `docs/01-runbook.md` §4 | Env set → `+ github-universal`, button on sign-in page. Env unset → `- github-universal (env vars not set …)`. |
| 1.5 Connector `metadata` (`target`, `name`) for multi-instance generic connectors + `profiles` filter (`SSO_PROFILE`, default `dev`); test entries `mock-google`, `mock-github` (`oidc` → mock provider) | EX-01, ID-01 (test path) | config + schema, `scripts/provision.js` | `SSO_PROFILE=test npm run provision` → `+ oidc/mock-google`, `+ oidc/mock-github`; default profile → `- … (profile test)`. |
| 1.6 Applications: `customClientMetadata` (rotation, TTL); schema forbids `*` in URIs; `hub` block (`allowedConnectors`, `consentReturnUris`; not sent to Logto); new apps `hub-ui` (Traditional) and `second-client` (`profiles: ["test"]`) | ID-09, HA-04, HA-05 | config + schema, `scripts/provision.js` | `GET /api/applications/{id}` shows metadata; schema unit test rejects `https://x/*`; `.env.apps` contains `HUB_UI_CLIENT_ID`/`SECRET`. |
| 1.7 Account Center fields `mfa: Edit`, `session: Edit` | ID-04, UI-01, LV-04 | config | `GET /api/account-center` fields include both. |
| 1.8 Profile fields: keep `displayName`/`jobTitle`; avatar = `avatar`, timezone = `profile.zoneinfo` (Account API) | ID-06 | config (`accountCenter.fields.avatar/profile` already `Edit`) | Integration: `PATCH /api/my-account/profile {zoneinfo}` → 200; `GET` returns it. |
| 1.9 `email` section replaces SMTP entries: `provider` (`ses` \| `cloudflare`, env override `EMAIL_PROVIDER`), shared `templates`, `devFallback` endpoint | EM-01, EM-02, EM-03 | config + schema, `scripts/provision.js`, `.env.example`, runbook §4 | No provider env → `= http-email (dev fallback)`. SES env → `+ aws-ses-mail`, `- http-email (dev fallback removed)`, SES `templates` equal config. |
| 1.10 Cloudflare relay — **blocked on open question Q1** | EM-01 (cloudflare), EM-03 | TBD | Relay receives `http-email` POST `{to,type,payload.code}`, renders config template, sends; LV-09 probe passes with `--email cloudflare`. |
| 1.11 Webhook: `hooks[]` (`User.Deleted` → Hub); signing key written to `.env.apps` as `HUB_WEBHOOK_SIGNING_KEY` | VA-08, NF-10 | config + schema, `scripts/provision.js` | `GET /api/hooks` shows hook; second run `=`; `.env.apps` has key. |
| 1.12 Role assignments via config (`roleAssignments[]`, `emailsEnv`) — see Q6 | ID-07, AD-02 | config + schema, `scripts/provision.js` | S9. |
| 1.13 Provision idempotency test | NF-10, AD-02 | `test/integration/provision.test.js` | S20: second run has zero `+` lines. |
| 1.14 Existing-asset checks: key rotation, branding, bootstrap, Console policy | ID-10, ID-11, ID-12, AD-01, AD-02 | `test/integration/rotate-keys.test.js`, runbook §2/§7 | Rotate → JWKS has old + new; a token signed by the old key still verifies in Hub. `GET /api/sign-in-exp` branding = config. Runbook states "Console: owner only; no edits provision would overwrite". |
| 1.15 Dev mailbox in compose; `devFallback.endpoint` → `http://mailbox:3099/email` | EM-02, NF-04 | `docker-compose.yml`, config | Sign-up code lands at `http://localhost:3099/`. |

### Phase 2 — Hub foundation

| Task | Reqs | Files | Done check |
|---|---|---|---|
| 2.1 Skeleton, scripts, deps (§6) | NF-01 | `apps/hub/**`, `package.json` | `npm run hub` starts; `GET /health` 200. Test: `package.json` deps ⊆ §6 list. |
| 2.2 DB + role on existing Postgres (idempotent) | NF-02 | `scripts/hub-db-init.js`, `package.json` (`hub:db:init`) | Run 1 `+ role hub`, `+ database hub`; run 2 `=`. |
| 2.3 Migration runner + `001_init.sql` | NF-03, NF-08 | `apps/hub/core/migrate.js`, `apps/hub/migrations/001_init.sql`, `package.json` (`hub:migrate`) | Rerun is a no-op. Test: every table in `information_schema.columns` has `tenant_id` (except Q5). |
| 2.4 Config + env loader; refuse start on missing secrets | NF-05, HA-05, CN-05 | `apps/hub/core/config.js` | Unset `HUB_MASTER_KEYS` → exit 1, stderr lists missing names. `applications[].hub` resolved to client IDs via `.env.apps`. |
| 2.5 JSON logger with redaction (key names + registered secret values) | NF-09, VA-07 | `apps/hub/core/log.js` | Unit: payload with `access_token`, `Authorization`, `password`, and a registered value → all `[REDACTED]`. |
| 2.6 `apps/lib/web.js`: optional `sessionStore` (default in-memory), JSON body/response, `headers` hook, `Secure` cookie on https. Hub: Postgres session store, session data encrypted with the vault | NF-02, NF-06, NF-07 | `apps/lib/web.js`, `apps/hub/core/session-store.js` | `sample-rp` unchanged (manual login). Hub session survives a Hub restart. DB scan finds no plaintext Logto tokens in `sessions`. |
| 2.7 Shared JWT verifier + caller context (`sub`, `client_id`, scopes) + registration check | HA-01, HA-02, HA-03, HA-05, IA-02 | `apps/lib/jwt.js`, `apps/hub/core/auth.js` | Unit: wrong `aud`, wrong `iss`, expired, bad signature, missing scope, unknown `client_id` → 401 / 403 / `client_not_registered`. |
| 2.8 Compose services + Dockerfile: `hub`, `mailbox`, `mock-provider` (profile `test`); `.env.example` covers all vars; production refuses `http://` `HUB_BASE_URL` | NF-04, NF-05, NF-06 | `docker-compose.yml`, `apps/hub/Dockerfile`, `.env.example` | `docker compose --profile test up -d` → all healthy. Test: every `process.env.X` in `apps/`, `scripts/`, `test/` appears in `.env.example` (or in the `.env.apps` generated list). |

### Phase 3 — Vault + extension points

| Task | Reqs | Files | Done check |
|---|---|---|---|
| 3.1 OpenAPI first (§4), committed before routes; `GET /v1/manifest` generated from it | TV-07 | `apps/hub/openapi.json`, `apps/hub/core/manifest.js` | Contract test: every Hub API route maps to an `operationId`; responses validate against its schema (test mode). |
| 3.2 Connector definition schema + registry: load dirs (`HUB_CONNECTOR_DIRS`), validate, resolve `env` (skip + log when missing), apply `hub.connectors.<id>.enabled` | CN-01, CN-02, CN-05, EX-02, EX-05 | `apps/hub/schemas/connector.schema.json`, `apps/hub/core/registry.js` | Invalid fixture → startup exit 1 with JSON pointer + message. Missing env → log `connector_skipped {id, missingEnv}`. Disabled → absent from API + UI. Static test: `apps/hub/core/**` has no import of `auth-types/*` or `connectors/*` by name. |
| 3.3 Auth type handler interface (§3.3) + handlers `oauth2`, `api_key`, `app_password` | EX-03 | `apps/hub/auth-types/types.js`, `oauth2.js`, `api-key.js`, `app-password.js`, `apps/hub/schemas/auth-type.schema.json` | Unit per handler with a stubbed `ctx.http`. |
| 3.4 Contract suites | EX-06 | `test/contract/auth-type.contract.js`, `test/contract/connector.contract.js` | S19: `npm run test:contract` covers every loaded handler + definition. |
| 3.5 Templates + authoring guide | EX-07 | `apps/hub/auth-types/_template.js`, `apps/hub/connectors/_template.json` (`_` prefix not loaded), `docs/03-hub-extensions.md` | Test copies each template to a temp dir with fixture values → passes its contract suite. |
| 3.6 New auth type without core change | EX-04 | `test/fixtures/auth-types/static-bearer.js` via `HUB_AUTH_TYPE_DIRS` | Contract suite passes; `git diff apps/hub/core` empty. |
| 3.7 Vault: envelope AES-256-GCM, versioned KEKs, re-encrypt command | VA-02 | `apps/hub/core/vault.js`, `scripts/hub-reencrypt.js`, `package.json` (`hub:reencrypt`) | Unit: round trip; tampered ciphertext/tag/AAD → throws; old version decrypts. Integration: re-encrypt moves all rows to the current version; rerun changes 0 rows. |

### Phase 4 — Mock provider, connectors, connections

| Task | Reqs | Files | Done check |
|---|---|---|---|
| 4.1 Mock provider (§7.3) | NF-04 | `test/mock-provider/server.js`, compose | Healthy; control API resets and reports call counts. |
| 4.2 Connector definitions + mock-pointed fixtures | CN-03, Deliverable 4 | `apps/hub/connectors/{clickup,hubspot,wordpress,google}.json`, `test/fixtures/connectors/{hubspot,clickup,google}.json` | Contract suite passes for all 4. Live smoke in 8.3. |
| 4.3 Connect flows: OAuth2 start/callback (state + PKCE in `oauth_states`), credential forms for `api_key`/`app_password` from `credentialFields`, labels, test before store | VA-01, VA-03, HA-04 | `apps/hub/routes/connect.js`, `apps/hub/core/connections.js` | S4. Mock `/me` returning 401 → nothing stored, UI shows error, audit `connection.create` result `failure`. |
| 4.4 States + on-demand refresh (≤ 5 min to expiry) under `pg_advisory_xact_lock`; provider 401 / failed refresh → `needs_reauth` | VA-04, VA-05, NF-07 | `apps/hub/core/connections.js`, `apps/hub/core/db.js` | S7. Integration: 20 parallel credential calls across 2 Hub processes → mock counts exactly 1 refresh. |
| 4.5 Disconnect: provider revoke (if defined) → delete secrets + consents | VA-06 | `apps/hub/core/connections.js` | Mock records a revoke call; rows gone. |
| 4.6 Secret hygiene in errors/logs/audit | VA-07 | `apps/hub/core/log.js`, `apps/hub/core/audit.js` | S13 subset (integration log capture). |
| 4.7 New `oauth2` connector, no code | CN-04 | `test/fixtures/connectors/acme.json` | S17. |

### Phase 5 — Consent, token API, audit, deletion

| Task | Reqs | Files | Done check |
|---|---|---|---|
| 5.1 Consent model + consent backend (app name from `applications[].name`; exact-match return URI) | TV-01, TV-02 | `apps/hub/core/consent.js`, `apps/hub/routes/ui-api.js` | S5, S6, S11 (return URI refused). |
| 5.2 Hub API routes per `openapi.json` | TV-04, TV-05, TV-06, HA-05 | `apps/hub/routes/api.js` | S5, S6, S8, S10, S11, S14. Integration: `connection_not_found` (other user's ID), `connector_not_allowed_for_client`. |
| 5.3 Audit log, append-only (trigger rejects UPDATE/DELETE) | AU-02, AU-03 | `apps/hub/core/audit.js`, migration | S16. `UPDATE audit_log …` → error. |
| 5.4 Logto webhook: verify `logto-signature-sha-256` (HMAC-SHA256 of raw body); `User.Deleted` → revoke (best effort) + delete connections, consents | VA-08 | `apps/hub/routes/webhooks.js` | S15. Bad signature → 401, no deletion. |
| 5.5 AU-01 identity events: no Hub code; runbook points to Logto Console audit logs | AU-01 | `docs/01-runbook.md` | `verify:logto` LV-06 PASS. |

### Phase 6 — Hub UI

| Task | Reqs | Files | Done check |
|---|---|---|---|
| 6.1 Vue 3 + Tailwind (Vite) app; theme tokens from `signInExperience.color` and branding | UI-06 | `apps/hub/ui/**`, `apps/hub/vite.config.js` | E2E at 375 px: no horizontal scroll; primary color = config `primaryColor`. |
| 6.2 Hub UI login via `apps/lib/oidc.js`; silent SSO | HA-04 | `apps/hub/routes/auth.js` | S3. |
| 6.3 Account: profile (name, avatar, `displayName`, `jobTitle`, timezone) via Account API; links to Account Center security, 2FA, sessions | UI-01, ID-06 | `apps/hub/ui/src/views/Account.vue`, `ui-api.js` | E2E edit → `GET /api/my-account` reflects it; links resolve (200). |
| 6.4 Connections (add, relabel, reconnect, delete, status), App access (grants + revoke), Consent page | UI-02, UI-03, UI-04, TV-02, TV-03 | `apps/hub/ui/src/views/{Connections,AppAccess,Consent}.vue` | S4, S5, S8. |
| 6.5 Hub admin (`owner`/`admin` from the `roles` claim): connector status, client settings (read-only), audit list with filters | UI-05, AU-04 | `apps/hub/ui/src/views/Admin*.vue`, `ui-api.js` | E2E: admin sees views and filters by user/event/client/date; `user` role → 403. |
| 6.6 CSP, HSTS (https), `frame-ancestors 'none'`, CSRF double-submit on state-changing UI calls | NF-06 | `apps/hub/core/security.js` | Integration: headers present; POST without CSRF token → 403. |
| 6.7 Retire `apps/profile-app` | §5, UI-01 | delete `apps/profile-app/`; config entry; `package.json` `profile`; README; runbook | `npm run profile` gone; README map updated; see Q10 for the orphaned Logto app. |

### Phase 7 — Reference client app + internal apps

| Task | Reqs | Files | Done check |
|---|---|---|---|
| 7.1 `sample-rp` → reference app: roles view, list consented connections, request credentials, follow `consentUrl`, fetch one record per connector with returned token + `baseUrl`. Key and name stay `sample-rp` / "Sample RP" (provision matches by name) | Deliverable 3, ID-07, TV-04, TV-05 | `apps/sample-rp/server.js`, `apps/lib/oidc.js` (`resourceToken(session, resource?)`) | S5. |
| 7.2 Second client: same server, `APP_KEY=second-client` | TV-01 | `apps/sample-rp/server.js`, `package.json` (`rp:second`) | S6. |
| 7.3 Internal-app pattern: verify an `https://api.authworks.local` token with `apps/lib/jwt.js`, read roles/permissions, no Hub call | IA-01, IA-02, IA-03 | `test/integration/internal-api.test.js` | Test passes; the Hub mock records 0 calls. |

### Phase 8 — Acceptance

| Task | Reqs | Files | Done check |
|---|---|---|---|
| 8.1 Playwright suite S1–S18 + extra specs (password reset, 2FA removal, admin, mobile) | §7.2 | `test/e2e/**`, `playwright.config.js` | `npm run test:e2e` green against `docker compose --profile test`. |
| 8.2 Post-run scans: DB plaintext (S12), logs (S13), responses (S14), audit completeness (S16) | VA-02, VA-07, TV-05, AU-02 | `test/e2e/global-teardown.js`, `test/lib/scan.js` | Each scan reports 0 hits. |
| 8.3 Live smoke per connector, auto-skip without creds | CN-03, §7.1 | `test/smoke/{clickup,hubspot,wordpress,google}.smoke.js` | With creds: test request + one record fetched. Without: `skip` with reason. |
| 8.4 Aggregate scripts: `test` (unit + contract), `test:int`, `test:e2e`, `test:smoke` | §7.1 | `package.json` | All exit 0. |

---

## 2. Traceability matrix

| ID | Task(s) | Proof |
|---|---|---|
| LV-01 | 0.1, 0.2 | `verify:logto` LV-01; S2 |
| LV-02 | 0.1, 0.2 | `verify:logto` LV-02; S1 |
| LV-03 | 0.1, 0.2 | `verify:logto` LV-03 |
| LV-04 | 0.1, 0.2 | `verify:logto` LV-04 |
| LV-05 | 0.1, 0.2, 1.3 | `verify:logto` LV-05 |
| LV-06 | 0.1, 0.2 | `verify:logto` LV-06 |
| LV-07 | 0.1, 0.2, 1.6 | `verify:logto` LV-07 |
| LV-08 | 0.1, 0.2, 1.2 | `verify:logto` LV-08; S9 |
| LV-09 | 0.1, 0.2, 0.3 | `verify:logto` LV-09 (http-email PASS; SES conditional) |
| ID-01 | 1.4, 1.5 | S2 (mock Google/GitHub); provision log for real `google-universal`/`github-universal` |
| ID-02 | 1.3, 1.9 | S1; E2E `password-reset.spec` |
| ID-03 | 1.3 | S2 |
| ID-04 | 1.3, 1.7 | S1; E2E `mfa-remove.spec` (Account Center) |
| ID-05 | 1.3 | Config test `mfa.policy === "PromptAtSignInAndSignUp"`; S1 |
| ID-06 | 1.8, 6.3 | E2E `account.spec` |
| ID-07 | 1.1, 1.2, 1.12 | S9 |
| ID-08 | 1.1 | S9, S10 (scope only via role) |
| ID-09 | 1.6 | Schema unit test (no wildcards); `verify:logto` LV-07 |
| ID-10 | 1.14 | `rotate-keys.test.js` |
| ID-11 | 1.14 | Integration: sign-in-exp branding = config |
| ID-12 | 1.14 | Runbook §2; every integration run depends on it (see Q2) |
| HA-01 | 2.7 | Unit JWT tests; S10 |
| HA-02 | 2.7 | Unit; S6 |
| HA-03 | 1.1, 2.7 | S10 |
| HA-04 | 1.6, 4.3, 6.2 | S3 |
| HA-05 | 1.6, 2.4, 2.7, 5.2 | S11; integration `connector_not_allowed_for_client` |
| CN-01 | 3.2 | Unit schema tests |
| CN-02 | 3.2 | Unit: missing env → `connector_skipped` log |
| CN-03 | 4.2, 8.3 | S4; contract suite; live smoke ×4 |
| CN-04 | 4.7 | S17 |
| CN-05 | 3.2 | Integration: invalid definition → exit 1 + message |
| VA-01 | 4.3 | Integration: 2 labelled HubSpot connections; E2E `connections.spec` |
| VA-02 | 3.7 | Unit vault; S12; re-encrypt integration |
| VA-03 | 4.3 | Integration: failing test request → not stored |
| VA-04 | 4.4 | S7; unit state transitions |
| VA-05 | 4.4 | S7; 2-process concurrency test |
| VA-06 | 4.5 | Integration: mock revoke count + rows deleted |
| VA-07 | 2.5, 4.6 | S13; unit redaction |
| VA-08 | 1.11, 5.4 | S15 |
| TV-01 | 5.1, 7.2 | S5, S6 |
| TV-02 | 5.1, 6.4 | S5, S11 |
| TV-03 | 6.4 | S8 |
| TV-04 | 5.2 | S5 |
| TV-05 | 5.2 | S5, S14 |
| TV-06 | 5.2 | S5, S7, S11; integration for `connection_not_found`, `connector_not_allowed_for_client` |
| TV-07 | 3.1 | OpenAPI contract test |
| IA-01 | 1.1 | `internal-api.test.js` |
| IA-02 | 2.7, 7.3 | `internal-api.test.js` |
| IA-03 | 7.3 | `internal-api.test.js` (0 Hub calls) |
| AU-01 | 5.5 | `verify:logto` LV-06 (Account Center part moved to spec §8) |
| AU-02 | 5.3 | S16 |
| AU-03 | 5.3 | Unit entry shape; S16 |
| AU-04 | 6.5 | E2E `admin.spec` |
| EM-01 | 1.9, 1.10, 0.3 | Provision integration (provider selection); LV-09; SES and Cloudflare conditional |
| EM-02 | 1.9, 1.15 | S1 |
| EM-03 | 1.9, 1.10 | Integration: SES `templates` = config |
| UI-01 | 1.7, 6.3 | E2E `account.spec` |
| UI-02 | 6.4 | S4; E2E `connections.spec` |
| UI-03 | 6.4 | S8 |
| UI-04 | 6.4 | S5 |
| UI-05 | 6.5 | E2E `admin.spec` |
| UI-06 | 6.1 | E2E `mobile.spec` |
| AD-01 | 1.14 | Runbook check (manual) |
| AD-02 | 1.12, 1.13, 1.14 | S20 |
| EX-01 | 1.4, 1.5 | S18 |
| EX-02 | 3.2 | Static import test |
| EX-03 | 3.3 | Contract suite |
| EX-04 | 3.6 | Contract suite + empty core diff |
| EX-05 | 3.2 | Integration: disabled connector absent |
| EX-06 | 3.4 | S19 |
| EX-07 | 3.5 | Template contract test |
| NF-01 | 2.1 | Dependency allow-list test |
| NF-02 | 2.2, 2.6 | Integration: Hub DB/role; session survives restart |
| NF-03 | 2.3 | `information_schema` test |
| NF-04 | 2.8, 4.1, 1.15 | Compose healthy; `.env.example` coverage test |
| NF-05 | 2.4 | Startup refusal test |
| NF-06 | 2.8, 6.6 | Headers/CSRF test; production `http://` refusal |
| NF-07 | 4.4 | 2-process refresh test |
| NF-08 | 2.3 | Migrate idempotency test |
| NF-09 | 2.5 | Unit; S13 |
| NF-10 | 1.1–1.13 | S20 |

Acceptance scenarios → specs: S1 `signup-totp`, S2 `account-linking`, S3 `sso`, S4 `connect`, S5 `consent-token`, S6 `second-client`, S7 `refresh-reauth`, S8 `revoke-consent`, S9 `role-claim`, S10 `token-rejection`, S11 `client-registration`, S12 (teardown DB scan), S13 (teardown log scan), S14 (teardown response scan), S15 `user-deletion`, S16 (teardown audit check), S17 `new-connector`, S18 `new-login-provider`, S19 `npm run test:contract`, S20 `provision.test.js`.

---

## 3. Hub design

### 3.1 Folder structure

```
apps/hub/
  server.js                 # load config → registry → start HTTP
  openapi.json              # TV-07 source of truth
  Dockerfile
  vite.config.js
  core/                     # provider-agnostic (EX-02)
    config.js  db.js  migrate.js  log.js  vault.js  session-store.js
    auth.js  registry.js  connections.js  consent.js  audit.js
    security.js  manifest.js  http-client.js
  auth-types/               # extension point 1 (EX-03)
    types.js  oauth2.js  api-key.js  app-password.js  _template.js
  connectors/               # extension point 2 (CN-01)
    clickup.json  hubspot.json  wordpress.json  google.json  _template.json
  schemas/
    connector.schema.json  auth-type.schema.json
  migrations/
    001_init.sql
  routes/
    api.js  connect.js  ui-api.js  auth.js  webhooks.js
  ui/                       # Vue 3 + Tailwind source → ui/dist
apps/lib/jwt.js             # shared JWKS verifier (Hub + internal apps)
scripts/hub-db-init.js  scripts/hub-reencrypt.js  scripts/verify-logto.js
test/{unit,integration,contract,e2e,smoke,fixtures,lib}/  test/mock-provider/server.js
```

### 3.2 Postgres data model (`hub` database)

Every table has `tenant_id text NOT NULL DEFAULT 'default'` as the first column of its primary key.

| Table | Key | Columns | Notes |
|---|---|---|---|
| `connections` | `(tenant_id, id uuid)` | `sub`, `connector_id`, `label`, `status` (`active`\|`needs_reauth`\|`revoked`\|`error`), `base_url`, `access_expires_at`, `provider_account_id`, `last_error_code`, `created_at`, `updated_at`, `last_refreshed_at` | Index `(tenant_id, sub)`. No secrets. |
| `connection_secrets` | `(tenant_id, connection_id)` FK → `connections` ON DELETE CASCADE | `key_version int`, `wrapped_dek bytea`, `dek_iv bytea`, `dek_tag bytea`, `iv bytea`, `ciphertext bytea`, `tag bytea` | AAD = `tenant_id|connection_id|key_version`. |
| `consent_grants` | `(tenant_id, id uuid)` | `sub`, `client_id`, `connection_id` FK CASCADE, `granted_at` | Unique `(tenant_id, client_id, connection_id)`. Revoke = delete. |
| `oauth_states` | `(tenant_id, state)` | `sub`, `connector_id`, `connection_id` (reconnect), `label`, `code_verifier` (vault-encrypted), `return_to`, `expires_at` | 10-minute TTL; deleted on use. |
| `sessions` | `(tenant_id, sid)` | `data` (vault-encrypted JSON), `expires_at` | NF-02; Logto tokens never stored in plaintext. |
| `audit_log` | `(tenant_id, id bigserial)` | `at`, `sub`, `client_id`, `connection_id`, `ip inet`, `user_agent`, `event_type`, `result` (`success`\|`failure`), `error_code`, `detail jsonb` | Trigger rejects UPDATE/DELETE. No FKs (outlives connections). |
| `schema_migrations` | `version int` | `name`, `applied_at` | Runner metadata; see Q5. |

`event_type` values (AU-02): `connection.create`, `connection.refresh_failure`, `connection.delete`, `consent.grant`, `consent.revoke`, `credential.issue`, `api.reject`, `user.deleted`.

Refresh lock (NF-07): `SELECT pg_advisory_xact_lock(hashtextextended(tenant_id || ':' || connection_id, 0))` inside the refresh transaction; re-read the expiry after acquiring.

Vault (VA-02): `HUB_MASTER_KEYS="v1:<b64 32B>,v2:<b64 32B>"`, `HUB_MASTER_KEY_CURRENT=v2`. A per-record random DEK encrypts the credential JSON (AES-256-GCM); the KEK wraps the DEK (AES-256-GCM). `hub:reencrypt` re-wraps DEKs to the current version.

### 3.3 Extension point interfaces (EX-03)

```js
/**
 * @typedef {object} HandlerCtx
 * @property {object} connector      validated connector definition
 * @property {{clientId?: string, clientSecret?: string}} client   resolved from env (CN-02)
 * @property {string} baseUrl        fixed or per-connection
 * @property {string} redirectUri    Hub OAuth callback
 * @property {(req: object) => Promise<Response>} http   fetch wrapper: timeout, redaction, SSRF guard
 *
 * @typedef {object} Credential      stored encrypted; never returned whole
 * @property {'oauth2'|'api_key'|'app_password'|string} kind
 * @property {string} [accessToken] @property {string} [refreshToken] @property {string} [expiresAt]
 * @property {string} [apiKey] @property {string} [username] @property {string} [password]
 * @property {object} [extra]
 *
 * @typedef {object} AuthTypeHandler
 * @property {string} type
 * @property {object} definitionSchema        JSON Schema for the connector's `<type>` block
 * @property {object} [credentialInputSchema] JSON Schema for user-entered fields
 * @property {(ctx: HandlerCtx, s: {state: string, codeChallenge?: string}) => Promise<{redirectUrl: string}>} [authorize]
 * @property {(ctx: HandlerCtx, cb: {query: URLSearchParams, codeVerifier?: string}) => Promise<Credential>} [handleCallback]
 * @property {(ctx: HandlerCtx, input: object) => Promise<Credential>} [collectCredentials]
 * @property {(ctx: HandlerCtx, c: Credential) => Promise<Credential>} [refresh]
 * @property {(ctx: HandlerCtx, c: Credential) => Promise<void>} [revoke]
 * @property {(ctx: HandlerCtx, c: Credential) => Promise<{ok: boolean, status: number, account?: {id: string, name?: string}}>} test
 * @property {(ctx: HandlerCtx, c: Credential) => {secret: object, expiresAt: string|null}} getCredentials   never includes refreshToken
 */
```

Rules: handlers do no persistence, locking, or encryption (core owns those). Exactly one of `authorize`+`handleCallback` or `collectCredentials` is required. The contract suite (EX-06) asserts the interface shape, `definitionSchema` validity, a round trip against the mock, that `getCredentials` output has no `refreshToken`/`refresh_token` key, and that `revoke` is idempotent.

### 3.4 Connector definition schema (CN-01)

```json
{
  "$id": "connector.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "name", "authType", "baseUrl", "test"],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
    "name": { "type": "string" },
    "authType": { "type": "string" },
    "env": { "type": "object", "additionalProperties": { "type": "string" }, "description": "clientId/clientSecret -> env var (CN-02)" },
    "oauth2": {
      "type": "object",
      "required": ["authorizeUrl", "tokenUrl", "scopes"],
      "properties": {
        "authorizeUrl": { "type": "string", "format": "uri" },
        "tokenUrl": { "type": "string", "format": "uri" },
        "revoke": { "type": "object", "properties": {
          "url": { "type": "string" }, "method": { "enum": ["POST", "DELETE"] },
          "tokenIn": { "enum": ["body", "query", "path"] }, "tokenType": { "enum": ["access_token", "refresh_token"] } } },
        "scopes": { "type": "array", "items": { "type": "string" } },
        "scopeDelimiter": { "type": "string", "default": " " },
        "pkce": { "type": "boolean" },
        "clientAuth": { "enum": ["basic", "body", "query"] },
        "authorizeParams": { "type": "object", "additionalProperties": { "type": "string" } },
        "refresh": { "type": "object", "properties": { "supported": { "type": "boolean" }, "rotatesRefreshToken": { "type": "boolean" } } }
      }
    },
    "credentialFields": { "type": "array", "items": { "type": "object", "required": ["name", "label", "type"],
      "properties": { "name": { "type": "string" }, "label": { "type": "string" }, "type": { "enum": ["url", "string", "secret"] }, "required": { "type": "boolean" } } } },
    "baseUrl": { "oneOf": [
      { "type": "object", "required": ["fixed"], "properties": { "fixed": { "type": "string", "format": "uri" } } },
      { "type": "object", "required": ["fromField"], "properties": { "fromField": { "type": "string" }, "pathSuffix": { "type": "string" } } } ] },
    "test": { "type": "object", "required": ["method", "path"], "properties": {
      "method": { "enum": ["GET", "POST"] }, "path": { "type": "string" },
      "headers": { "type": "object", "additionalProperties": { "type": "string" }, "description": "{{accessToken}} {{apiKey}} {{basic}} placeholders" },
      "expectStatus": { "type": "integer", "default": 200 },
      "accountIdPath": { "type": "string" }, "accountNamePath": { "type": "string" } } },
    "auth": { "type": "object", "description": "How apps send the credential; returned by TV-05",
      "properties": { "header": { "type": "string" }, "format": { "type": "string" } } }
  }
}
```

v1 definitions:

| Connector | `authType` | Points to handle |
|---|---|---|
| ClickUp | `oauth2` | `clientAuth: "query"`; no refresh (`refresh.supported: false`, `expiresAt: null`); header `Authorization: {{accessToken}}` (no `Bearer`); no revoke |
| HubSpot | `oauth2` | `clientAuth: "body"`; refresh; revoke `DELETE …/oauth/v1/refresh-tokens/{token}` (`tokenIn: path`, `tokenType: refresh_token`) |
| WordPress | `app_password` | `credentialFields`: `siteUrl` (url), `username`, `appPassword` (secret); `baseUrl.fromField: "siteUrl"` + `/wp-json`; test `GET /wp/v2/users/me` with Basic auth |
| Google | `oauth2` | separate client env `HUB_GOOGLE_CLIENT_ID`/`SECRET`; `authorizeParams: {access_type: "offline", prompt: "consent"}`; revoke `POST https://oauth2.googleapis.com/revoke` (`tokenIn: query`) |

Test-time overrides: `HUB_CONNECTOR_DIRS=apps/hub/connectors,test/fixtures/connectors`. A later directory replaces a definition with the same `id`, so mock-pointed copies need no templating.

---

## 4. Hub API (OpenAPI outline, schema-first)

`apps/hub/openapi.json` (OpenAPI 3.1, JSON, so no YAML dependency). Every response uses one envelope (rule 05, Layer A):

```json
{ "meta": { "requestId": "req_…", "apiVersion": "1" }, "data": { } }
{ "meta": { "requestId": "req_…", "apiVersion": "1" }, "error": { "code": "consent_required", "message": "…", "consentUrl": "https://hub…/consent?…" } }
```

```json
{
  "openapi": "3.1.0",
  "info": { "title": "AuthWorksOne Connector Hub API", "version": "1" },
  "components": {
    "securitySchemes": { "logto": { "type": "http", "scheme": "bearer", "bearerFormat": "JWT (aud = hub resource)" } },
    "schemas": {
      "Connection": { "type": "object", "additionalProperties": false,
        "required": ["id", "connectorId", "label", "status"],
        "properties": { "id": { "type": "string", "format": "uuid" }, "connectorId": { "type": "string" }, "label": { "type": "string" },
          "status": { "enum": ["active", "needs_reauth", "revoked", "error"] }, "baseUrl": { "type": "string" } } },
      "CredentialRequest": { "oneOf": [
        { "type": "object", "required": ["connectionId"], "properties": { "connectionId": { "type": "string", "format": "uuid" }, "returnTo": { "type": "string" } } },
        { "type": "object", "required": ["connectorId"], "properties": { "connectorId": { "type": "string" }, "returnTo": { "type": "string" } } } ] },
      "Credential": { "type": "object", "additionalProperties": false,
        "required": ["connectionId", "connectorId", "authType", "secret", "baseUrl"],
        "properties": { "connectionId": { "type": "string" }, "connectorId": { "type": "string" }, "authType": { "type": "string" },
          "secret": { "type": "object", "additionalProperties": false,
            "properties": { "accessToken": { "type": "string" }, "apiKey": { "type": "string" }, "username": { "type": "string" }, "appPassword": { "type": "string" } } },
          "expiresAt": { "type": ["string", "null"], "format": "date-time" }, "baseUrl": { "type": "string" },
          "auth": { "type": "object", "properties": { "header": { "type": "string" }, "format": { "type": "string" } } } } },
      "Error": { "type": "object", "required": ["code", "message"],
        "properties": { "code": { "enum": ["consent_required", "connection_reauth_required", "connection_not_found",
          "connector_not_allowed_for_client", "client_not_registered", "invalid_token", "insufficient_scope", "provider_unavailable"] },
          "message": { "type": "string" }, "consentUrl": { "type": "string" }, "reconnectUrl": { "type": "string" } } }
    }
  },
  "paths": {
    "/v1/connections": { "get": { "operationId": "list_connections", "security": [{ "logto": ["connections:read"] }],
      "description": "List the caller's connections that the user has consented to for the calling client_id (TV-04).",
      "responses": { "200": "{ data: Connection[] }", "401": "invalid_token", "403": "insufficient_scope | client_not_registered" } } },
    "/v1/credentials": { "post": { "operationId": "get_credentials", "security": [{ "logto": ["connections:token"] }],
      "description": "Short-lived provider credentials for one consented connection; refreshes if within 5 min of expiry (TV-05). Never returns refresh tokens.",
      "requestBody": "CredentialRequest",
      "responses": { "200": "{ data: Credential }", "401": "invalid_token", "403": "insufficient_scope | client_not_registered | connector_not_allowed_for_client | consent_required (+consentUrl)",
        "404": "connection_not_found", "409": "connection_reauth_required (+reconnectUrl)", "503": "provider_unavailable" } } },
    "/v1/manifest": { "get": { "operationId": "manifest", "description": "MCP-style tools list generated from this document (rule 05, Layer B)." } }
  }
}
```

Behavior rules:
- `connection_not_found` covers both a missing connection and one owned by a different `sub`, so IDs can't be enumerated.
- `consentUrl` = `${HUB_BASE_URL}/consent?client_id=…&(connection_id|connector)=…&return_to=…`. `return_to` must exactly match an entry in `consentReturnUris`, otherwise the first entry is used.
- Order of checks: token (HA-01) → scope (HA-03) → `client_not_registered` (HA-05) → `connector_not_allowed_for_client` → ownership → consent (TV-01) → status → refresh.
- Internal (non-public) routes: `/login`, `/callback`, `/logout`, `/connect/{connectorId}`, `/connect/callback`, `/consent`, `/ui-api/*` (session + CSRF), `/webhooks/logto` (HMAC), `/health`.

---

## 5. Config changes

### 5.1 `config/sso.config.json` — new or changed sections

```json
{
  "resources": [
    { "name": "AuthWorks Sample API", "indicator": "https://api.authworks.local", "scopes": [{ "name": "read:sample" }] },
    { "name": "Connector Hub", "indicator": "https://hub.authworks.local",
      "scopes": [{ "name": "connections:read" }, { "name": "connections:token" }] }
  ],
  "roles": [
    { "name": "owner", "description": "Platform owner", "permissions": [{ "resource": "https://hub.authworks.local", "scopes": ["connections:read", "connections:token"] }] },
    { "name": "admin", "description": "Hub admin", "permissions": [{ "resource": "https://hub.authworks.local", "scopes": ["connections:read", "connections:token"] }] },
    { "name": "user", "description": "Default", "isDefault": true, "permissions": [{ "resource": "https://hub.authworks.local", "scopes": ["connections:read", "connections:token"] }] }
  ],
  "roleAssignments": [{ "role": "owner", "emailsEnv": "OWNER_EMAILS" }],
  "applications": [
    { "key": "sample-rp", "name": "Sample RP", "type": "Traditional", "resource": "https://hub.authworks.local",
      "customClientMetadata": { "rotateRefreshToken": true, "refreshTokenTtlInDays": 14 },
      "hub": { "allowedConnectors": ["clickup", "hubspot", "wordpress", "google"], "consentReturnUris": ["http://localhost:3010/connections"] } },
    { "key": "hub-ui", "name": "Connector Hub", "type": "Traditional", "baseUrl": "http://localhost:3030", "port": 3030,
      "scope": "openid profile email custom_data offline_access", "resource": "https://hub.authworks.local",
      "redirectUris": ["http://localhost:3030/callback"], "postLogoutRedirectUris": ["http://localhost:3030/"] },
    { "key": "second-client", "name": "Second Client", "type": "Traditional", "profiles": ["test"], "hub": { "allowedConnectors": ["hubspot"], "consentReturnUris": ["http://localhost:3011/connections"] } }
  ],
  "connectors": [
    { "connectorId": "github-universal", "configEnv": { "clientId": "GITHUB_CLIENT_ID", "clientSecret": "GITHUB_CLIENT_SECRET" } },
    { "connectorId": "oidc", "profiles": ["test"], "metadata": { "target": "mock-google", "name": "Google (mock)" },
      "config": { "authorizationEndpoint": "http://localhost:3097/oidc/authorize", "tokenEndpoint": "http://mock-provider:3097/oidc/token",
        "clientId": "mock-google", "clientSecret": "mock", "scope": "openid email profile",
        "idTokenVerificationConfig": { "jwksUri": "http://mock-provider:3097/oidc/jwks" } } }
  ],
  "email": {
    "provider": "ses",
    "templates": [ { "usageType": "SignIn", "subject": "…", "content": "…" } ],
    "ses": { "configEnv": { "accessKeyId": "AWS_SES_ACCESS_KEY_ID", "accessKeySecret": "AWS_SES_SECRET", "region": "AWS_SES_REGION", "emailAddress": "AWS_SES_FROM" } },
    "cloudflare": { "configEnv": { "endpoint": "EMAIL_RELAY_URL", "authorization": "EMAIL_RELAY_TOKEN" } },
    "devFallback": { "endpoint": "http://mailbox:3099/email" }
  },
  "hooks": [{ "name": "hub-user-deleted", "events": ["User.Deleted"], "url": "http://hub:3030/webhooks/logto", "signingKeyEnvOut": "HUB_WEBHOOK_SIGNING_KEY" }],
  "signInExperience": {
    "forgotPasswordMethods": ["EmailVerificationCode"],
    "socialSignIn": { "automaticAccountLinking": true },
    "mfa": { "factors": ["Totp", "BackupCode"], "policy": "PromptAtSignInAndSignUp" },
    "sentinelPolicy": { "maxAttempts": 5, "lockoutDuration": 15 },
    "socialSignInConnectorTargets": ["google", "github", "mock-google", "mock-github"]
  },
  "accountCenter": { "enabled": true, "fields": { "mfa": "Edit", "session": "Edit" } },
  "customJwtClaims": { "fromCustomData": ["displayName", "jobTitle"], "roles": true },
  "hub": {
    "resource": "https://hub.authworks.local",
    "connectors": { "clickup": { "enabled": true }, "hubspot": { "enabled": true }, "wordpress": { "enabled": true }, "google": { "enabled": true } }
  }
}
```

Fragment only. Unchanged keys are omitted, and `…` marks values copied from the current config. The `simple-mail-transfer-protocol` and old `http-email` connector entries are removed (moved into `email`). The `profile-app` entry is removed in task 6.7.

### 5.2 `config/schemas/sso.config.schema.json`

| Path | Change |
|---|---|
| `resources[].scopes` | array of `{name, description?}` |
| `roles[]` | new: `{name, description, isDefault?, permissions: [{resource (uri), scopes: string[]}]}` |
| `roleAssignments[]` | new: `{role, emailsEnv}` |
| `applications[]` | add `customClientMetadata {rotateRefreshToken, refreshTokenTtlInDays (1–90)}`, `hub {allowedConnectors: string[], consentReturnUris: uri[]}`, `profiles: string[]`; `redirectUris`/`postLogoutRedirectUris`/`consentReturnUris` items `"not": {"pattern": "\\*"}` |
| `connectors[]` | add `metadata {target, name}`, `profiles: string[]` |
| `email` | new: `provider` enum `ses`\|`cloudflare`, `templates[]` `{usageType, subject, content, contentType?}`, `ses`, `cloudflare` (`configEnv` maps), `devFallback {endpoint}` |
| `hooks[]` | new: `{name, events: string[], url (uri), signingKeyEnvOut}` |
| `signInExperience` | document passthrough keys `forgotPasswordMethods`, `socialSignIn`, `mfa {factors, policy}`, `sentinelPolicy {maxAttempts, lockoutDuration}` |
| `customJwtClaims.roles` | boolean |
| `hub` | new: `{resource (uri), connectors: {<id>: {enabled: boolean}}}` (Hub-only; provision reads only `resource`) |

### 5.3 `scripts/provision.js` — new steps (all `+ / = / -`)

| Step (order) | Behavior |
|---|---|
| Profile filter | Drop `connectors[]`/`applications[]` entries whose `profiles` don't include `SSO_PROFILE` (default `dev`); log `- <name> (profile <p>)`. |
| Resources | Existing step plus scope sync per resource: `GET/POST /api/resources/{id}/scopes` by name. |
| Roles | `GET /api/roles` by name → `POST`/`PATCH` (`description`, `isDefault`); permissions via `POST /api/roles/{id}/scopes` for missing scope IDs. |
| Connectors | Existing step plus `metadata` on create/patch; match generic connectors by `connectorId + metadata.target`. |
| Email | Resolve `EMAIL_PROVIDER ?? email.provider`. Complete env → apply that connector with `templates`, delete other Email connectors. Incomplete → apply `http-email` with `devFallback.endpoint` and log `- <provider> (env vars not set: …)`. |
| Sign-in experience | Existing PATCH; new keys pass through. |
| Applications | Existing step plus `customClientMetadata` PATCH; `hub`/`profiles`/`port`/`baseUrl` never sent to Logto. |
| Role assignments | Look up users by email (`GET /api/users?search=`); assign missing roles; `-` when user absent. |
| Hooks | `GET /api/hooks` by name → `POST`/`PATCH`; `GET /api/hooks/{id}/signing-key` → `.env.apps`. |
| JWT claims | Generator adds `roles: (context.user.roles ?? []).map((r) => r.name)` when `customJwtClaims.roles`. |

### 5.4 `.env.example` additions

`SSO_PROFILE`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `EMAIL_PROVIDER`, `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET`, `AWS_SES_REGION`, `AWS_SES_FROM`, `EMAIL_RELAY_URL`, `EMAIL_RELAY_TOKEN`, `OWNER_EMAILS`, `HUB_BASE_URL`, `HUB_DATABASE_URL`, `HUB_DB_PASSWORD`, `HUB_MASTER_KEYS`, `HUB_MASTER_KEY_CURRENT`, `HUB_CONNECTOR_DIRS`, `HUB_AUTH_TYPE_DIRS`, `HUB_ALLOW_PRIVATE_URLS`, `CLICKUP_CLIENT_ID`, `CLICKUP_CLIENT_SECRET`, `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, `HUB_GOOGLE_CLIENT_ID`, `HUB_GOOGLE_CLIENT_SECRET`, `SMOKE_*` (per connector). Remove `SMTP_*`. Generated into `.env.apps`: `HUB_UI_CLIENT_ID`/`SECRET`, `SECOND_CLIENT_CLIENT_ID`/`SECRET`, `HUB_WEBHOOK_SIGNING_KEY`.

---

## 6. Dependencies

| Package | Scope | Justification (NF-01) |
|---|---|---|
| `openid-client` ^6 | runtime | Existing. Certified RP for Hub UI login (HA-04) and connector OAuth discovery where available. |
| `jose` ^6 | runtime | Existing. JWKS verification (HA-01, IA-02), mock IdP token signing. |
| `postgres` ^3 | runtime | Node has no Postgres driver. Zero transitive deps; supports advisory locks and transactions (NF-02, NF-07). Alternative `pg`: see Q8. |
| `ajv` ^8 | runtime | JSON Schema validation for connector definitions (CN-05), config, and OpenAPI request/response checks (TV-07). A hand-rolled validator would be larger and less safe. |
| `ajv-formats` ^3 | runtime | `format: uri`/`date-time` already used by the config schema and OpenAPI. |
| `vue` ^3 | runtime (UI bundle) | Spec decision: Hub UI in Vue 3. |
| `vite` + `@vitejs/plugin-vue` | dev | Build Vue SFCs into static assets served by the Hub; no runtime server. See Q8. |
| `tailwindcss` ^4 + `@tailwindcss/vite` | dev | Spec decision: Tailwind. |
| `@playwright/test` | dev | Spec §7.1 E2E. |

Not added: HTTP framework (Node `http` + `apps/lib/web.js`), YAML parser (OpenAPI is JSON), test runner (`node:test`), crypto (`node:crypto`), mock servers (Node `http` + `jose`), TOTP (`node:crypto` HMAC, as in the Phase 0 probe).

---

## 7. Test plan

### 7.1 Layers

| Layer | Runner | Scope | Command |
|---|---|---|---|
| Unit | `node:test` | vault, connector/auth-type/config schema validation, handlers (stubbed `http`), consent rules, return-URI matcher, refresh-window logic, JWT verifier (local JWKS from `jose.generateKeyPair`), redaction, JWT-script generator | `npm test` |
| Contract | `node:test` | EX-06 suites over every handler and definition, OpenAPI route conformance | `npm run test:contract` |
| Integration | `node:test` | Hub + compose Postgres + mock provider: connect, refresh, refresh failure, revoke, expired → `needs_reauth`, 2-process lock, webhook HMAC + deletion, re-encrypt, migrations; live Logto: provision twice (S20), rotate keys, `verify:logto` | `npm run test:int` |
| E2E | Playwright | `docker compose --profile test`, `SSO_PROFILE=test` provision, reference app + second client, S1–S18 | `npm run test:e2e` |
| Live smoke | `node:test` | one test per connector against real accounts; `t.skip()` when `SMOKE_<ID>_*` is unset | `npm run test:smoke` |

### 7.2 E2E environment

- Global setup: wait for health checks → `npm run hub:db:init && npm run hub:migrate` → `SSO_PROFILE=test npm run provision` → reset the mock and mailbox.
- Email codes: poll `GET http://localhost:3099/`, filter messages whose JSON `body` has `to === <test email>` and `type ∈ {Register, SignIn, ForgotPassword, Generic}`, and read `payload.code`. The format was verified in Phase 0 (LV-09), so no mailbox changes are needed.
- TOTP: read the secret text from the Logto MFA binding page and compute codes with the shared `test/lib/totp.js` (RFC 6238, `node:crypto`).
- Unique emails per test (`e2e-<spec>-<ts>@example.com`); teardown deletes test users through the Management API.
- Pin the Logto image; keep hosted-page selectors in `test/e2e/pages/logto.js` (one place to fix after an upgrade).

### 7.3 Mock provider (`test/mock-provider/server.js`, port 3097, compose profile `test`)

| Surface | Endpoints | Behavior |
|---|---|---|
| OIDC IdP (Logto test login) | `/oidc/authorize` (HTML form: email + "verified" checkbox), `/oidc/token`, `/oidc/jwks`, `/oidc/userinfo` | ES256 ID tokens with `email`, `email_verified`, `nonce`. `client_id` distinguishes mock-google/mock-github. Pattern proven by the Phase 0 LV-01 probe. |
| OAuth2 AS (Hub connectors) | `/oauth/authorize` (auto-approve), `/oauth/token` (`authorization_code`, `refresh_token`), `/oauth/revoke`, `/oauth/refresh-tokens/{t}` (DELETE, HubSpot shape) | Tokens prefixed `mock_at_` / `mock_rt_` (log/DB scans). Quirks via path prefix `/p/{clickup\|hubspot\|google\|generic}/…`. |
| Resource API | `/api/me`, `/api/records` | 401 for expired or revoked tokens. |
| WordPress | `/wp-json/wp/v2/users/me`, `/wp-json/wp/v2/posts?per_page=1` | Basic auth against seeded app passwords. |
| Control | `POST /_control/expire`, `POST /_control/fail-refresh`, `POST /_control/reset`, `GET /_control/calls` | Drives S7, the concurrency test (refresh call count), and revoke assertions. |

URL split: browser-facing authorize URLs use `http://localhost:3097`; container-to-container token and JWKS URLs use `http://mock-provider:3097`. Logto's OIDC connector and the Hub definitions both allow separate authorize and token URLs.

### 7.4 Scans (teardown)

- **S12 DB:** for every `text`/`bytea`/`jsonb` column in the `hub` DB, search for each plaintext secret the run produced (mock tokens, app passwords, API keys, client secrets, Logto tokens captured by the reference app).
- **S13 logs:** run all services with logs to files; search for the same values plus the patterns `eyJ[\w-]+\.[\w-]+\.`, `mock_[ar]t_`, and the `HUB_MASTER_KEYS` values.
- **S14 responses:** a Playwright request hook records Hub API responses; assert no `refresh_token`/`refreshToken` key and no `mock_rt_` value.
- **S16 audit:** the expected-event ledger built during the run ⊆ `audit_log` rows.

---

## 8. Risks and open questions

### Open questions (unresolved — need a decision)

| # | Question | Blocks |
|---|---|---|
| Q1 | Cloudflare relay: build it here (Cloudflare Worker with the email-sending binding, or a Node service)? `http-email` sends only `{to, type, payload.code}`, so the relay must render EM-03 templates. | 1.10, EM-01/EM-03 Cloudflare path |
| Q2 | E2E on a fresh DB needs the manual bootstrap (runbook §2: admin + M2M). Use a persistent, bootstrapped test volume, or seed the M2M app another way? | 8.1, CI |
| Q3 | First-time consent needs a connector-level request: `POST /v1/credentials {connectorId}` (§4) vs. only `{connectionId}` as TV-05 literally states. | 5.2, S5 |
| Q4 | Rule 05 asks for MCP discovery. The plan ships `GET /v1/manifest` (tools list); a full MCP JSON-RPC transport is not planned. OK? | 3.1 |
| Q5 | `schema_migrations` without `tenant_id` (runner metadata) vs. NF-03 "every Hub table". | 2.3 |
| Q6 | S9 "assigns a role via config/provision": the plan adds `roleAssignments[]` with emails from env (`OWNER_EMAILS`) to keep PII out of git. AD-01 keeps ad-hoc assignment in the Console. OK? | 1.12, S9 |
| Q7 | Lockout values: assumed `maxAttempts: 5`, `lockoutDuration: 15` (minutes). | 1.3 |
| Q8 | UI tooling (Vite + `@vitejs/plugin-vue` + Tailwind v4) and Postgres driver (`postgres` vs `pg`). | 2.1, 6.1 |
| Q9 | A `User.Deleted` webhook missed while the Hub is down leaves orphaned connections. Add reconciliation (not in spec), or accept? | 5.4, VA-08 |
| Q10 | Provision never deletes. Retiring `profile-app` leaves its Logto app; delete it manually in the Console or add `-` removal for config-dropped apps? | 6.7, AD-02 |
| Q11 | Logto applies default roles only at user creation. Existing users need a one-time `user` role backfill to get Hub scopes. | 1.1 |
| Q12 | TV-05 response adds `authType` and `auth` (header/format) beyond the spec's list, and errors add `invalid_token`, `insufficient_scope`, `provider_unavailable` beyond TV-06. OK? | 3.1, 5.2 |
| Q13 | Confidential clients rotate refresh tokens only after 70% of TTL (LV-07). Does that satisfy ID-09's "refresh token rotation"? | 1.6 |
| Q14 | The 1.41.0 Account Center bundle contains a `/profile` route, while `memory/gotchas.md` says it is missing. Re-check in a browser; the gotcha may be stale (no scope impact: profile editing is in the Hub UI per UI-01). | 6.3 |

### Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Logto hosted-page DOM changes break Playwright. | Pinned image; page objects in one file; `verify:logto` before upgrades. |
| R2 | Account linking only happens in Logto's hosted UI (gotchas). | Use the hosted UI only; API tests replicate `linkSocialIdentity: true`. |
| R3 | SSRF through per-connection WordPress `siteUrl`. | `http-client.js` guard: https only in production; block private/loopback/link-local ranges unless `HUB_ALLOW_PRIVATE_URLS=1` (dev/test). |
| R4 | Provider quirks outgrow the declarative schema (CN-04 "where possible"). | Quirk fields in §3.4; anything else becomes a new auth type (EX-04), never core code. |
| R5 | Logto tokens in Hub session rows would fail S12. | Session data is vault-encrypted (2.6). |
| R6 | `http-email` is a single Logto connector shared by the dev fallback and the Cloudflare relay. | `email` section owns it; one endpoint chosen by provider/env (5.3). |
| R7 | Losing `HUB_MASTER_KEYS` makes every connection unrecoverable. | Runbook: back up keys with `.env`; re-encrypt procedure; keep old versions until `hub:reencrypt` reports 0 rows. |
| R8 | Google Drive/Calendar scopes need Google app verification for production. | Live smoke uses test users; production verification tracked outside v1. |
| R9 | Spec §3.0 says failed items move to "Section 7", but the out-of-scope list is §8. | Plan and spec edit use §8. |
| R10 | Renaming the `sample-rp` app's `name` would create a duplicate Logto app (provision matches by name). | Keep `key` and `name`; only behavior changes (7.1). |
