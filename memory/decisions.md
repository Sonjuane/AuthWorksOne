---
type: decision-log
title: Decisions
description: ADR-style log of significant technical decisions and their rationale.
last_updated: 2026-10-24
---

# Decisions

## 2026-07-07 — Logto as the IdP, pinned to image `svhd/logto:1.41`
Certified OIDC provider with hosted sign-in UI, user store, connectors, Account API, and Management API — no provider layer to build. Pinned tag for reproducibility; upgrades are deliberate (check Account Center page availability, see gotchas).

## 2026-07-07 — Management-API-as-code over Admin Console (user choice 5A)
All tenant config lives in `config/sso.config.json`, applied by `scripts/provision.js` (idempotent: `+` create, `=` update, `-` skip). The only Console-manual step is the one-time bootstrap (admin user + M2M app), which Logto OSS cannot script.

## 2026-07-07 — Profile self-service: prebuilt Account Center AND custom app (user choice 3 A+B)
Prebuilt `/account` pages handle security fields (email, username, password). `apps/profile-app` handles name/avatar/custom fields via `PATCH /api/my-account` — needed anyway because 1.41 lacks the `/account/profile` page.

## 2026-07-07 — Dependencies: `openid-client` + `jose` only
`openid-client` is the reference certified RP implementation (PKCE, discovery, ID-token JWKS verification, end-session); `jose` (already its transitive dep) verifies resource JWTs like an API would. HTTP servers, sessions, and the Management API client are hand-rolled on Node built-ins to keep the footprint minimal per dev rules.

## 2026-07-07 — Dev email: `http-email` fallback connector + local mailbox
Logto hard-requires an Email connector when email is a sign-up identifier (`verify: true` is enforced). Without SMTP creds, provision installs the `http-email` connector pointed at `scripts/dev-mailbox.js` and auto-removes it when real SMTP appears. Chosen over username-signup fallback (changes UX silently) and over failing hard (blocks dev).

## 2026-07-07 — Custom claims via `custom_data` + generated JWT-customizer script
Profile fields `displayName` / `jobTitle` live in user `customData`, are collected at sign-up (custom profile fields), surface in `userinfo` via the `custom_data` scope, and are copied into resource JWT access tokens by a customizer script generated from config — one declaration, no drift.

## 2026-10-23 — Keep Logto for identity; add a custom Connector Hub for third-party connections
Spec: `AuthWorksOne_Requirments.md`. Logto covers login, 2FA, roles, SSO, and admin, so only the connector vault is custom. The Hub (Node + Postgres, Vue UI) runs its own connector OAuth flows, stores credentials encrypted, enforces per-app consent, and trusts Logto JWTs issued for the Hub resource. Logto's Secret Vault was rejected because it allows one identity per provider per user and has no per-app consent or API key / app password support. Logto features still unverified on 1.41 are listed as Phase 0 checks (spec §3.0).

## 2026-10-23 — Stay on Logto 1.41; move Account Center audit coverage to spec §8 (user choice)
Phase 0 (gotchas.md) passed LV-01–LV-08 and the http-email half of LV-09, so no upgrade is needed. LV-06 showed that Account API / Account Center changes are not in Logto's audit log. Per the §3.0 rule, that part of AU-01 moved to spec §8. No custom webhook-based replacement.

## 2026-10-23 — Global MFA policy `PromptAtSignInAndSignUp` (user choice)
Logto 1.41 has no per-role MFA enforcement (LV-03), and organizations are out of scope for v1. ID-05 uses one global policy: TOTP + backup codes, prompted once at sign-up/sign-in, skippable.

## 2026-10-23 — Per-client Hub settings live under `applications[].hub`, resolved to client IDs at Hub startup (user choice)
Logto app IDs are generated per environment, so committed config keys apps by `key`. The Hub maps `key` → `<KEY>_CLIENT_ID` from `.env.apps` and enforces HA-05 by real `client_id` at runtime.

## 2026-10-24 — Upgrade Logto 1.41 → 1.45 (user request)
Image `svhd/logto:1.45` (core 1.45.0, latest stable). Ran `db alteration deploy 1.45.0` (16 alterations); pre-upgrade dump in `backup/` (git-ignored). Phase 0 probes re-ran with identical results. The AU-01 gap remains, so the §8 move stands. Supersedes "stay on 1.41" above.

## 2026-10-24 — Reference client app (Phase 7; user choices)
- **Record paths:** the reference app fetches one record at each provider's real path (HubSpot `/crm/v3/objects/contacts?limit=1`, ClickUp `/team`, Drive `/drive/v3/files?pageSize=1`, WP `/wp/v2/posts?per_page=1`). The mock provider serves the same paths, so app code is identical for mock and real. This was chosen over an env-overridable path map.
- **`second-client` is always provisioned:** its `profiles: ["test"]` tag is dropped, so `npm run rp:second` works in dev. This was chosen over `SSO_PROFILE=test` on the dev tenant, which would also add the mock login buttons, and over a throwaway app per test run.
- **Verification before Playwright:** a live integration test (`reference-app.test.js`) proves S5/S6 by running both RP processes against a test Hub. The consent click is a service call; the Hub consent page has its own tests.
- **Hub resource at login:** an app with a `hub` block requests `hub.resource` as an extra `resource`. The Hub resource scopes (`connections:read connections:token`) go in the app's `scope`.

## 2026-10-24 — Provision stays add/update-only (Q10 user choice a)
Retiring an app from `config/sso.config.json` doesn't delete it in Logto. The owner deletes it once in the Admin Console (first case: "Profile App" after build plan task 6.7). This was chosen because a pruning provisioner could delete a working app after a config mistake. **Possible later:** opt-in pruning of config-dropped apps, limited to apps provision created, with a dry-run preview (build plan Q10).

## 2026-10-24 — Consent, app API, deletion (Phase 5; Q9 user choice A)
- **Q9: reconciliation is an operator command** (`npm run hub:reconcile`) using the provisioner's Management API credentials. The Hub never holds Logto admin rights, because OSS Management API access is all-or-nothing. Safety rails: `--dry-run`; abort on an empty Logto list or more than 20% missing unless `--force`.
- **Webhook reachability:** the compose network subnet is pinned, and Logto's `SSRF_ALLOWED_ADDRESSES` is set to exactly that subnet. This was chosen over `SSRF_PROTECTION_DISABLED` or allowing all private ranges.
- **One-connection rule:** `POST /v1/credentials {connectorId}` resolves only when exactly one connection is consented. Several → `invalid_request` with the list, so the app must pass `connectionId`.
- **Consent page:** the backend is a JSON UI API now; the Vue page arrives in Phase 6 (no throwaway server-rendered page).

## 2026-10-24 — Connections and Hub login (Phase 4)
- **SSRF default (user-approved):** provider URLs must be https and resolve to public addresses. `HUB_ALLOW_PRIVATE_URLS=1` relaxes this for dev/test and is refused in production.
- **Hub UI login moved earlier:** it was built in Phase 4 (task 6.2) because connect flows need a signed-in user.
- **Lock scope:** the refresh is serialized with a Postgres advisory transaction lock, and the expiry is re-checked after acquiring it. The provider call happens inside the transaction, which is acceptable at v1 scale.
- **`needs_reauth` persists:** it's committed inside the refresh transaction, and the error is raised after commit.
- **Integration test tenant:** service tests use tenant `itest`, so their append-only audit rows stay out of `default`.

## 2026-10-24 — Hub API and extension-point shape (Phase 3; Q3, Q4, Q12 user choice)
- **Q3:** `POST /v1/credentials` accepts `{connectionId}` or `{connectorId}`. The connector form lets an app start first consent without knowing a connection id.
- **Q4:** discovery is `GET /v1/manifest`, generated from `openapi.json`. There is no MCP JSON-RPC transport.
- **Q12:** the credential response adds `authType` and an `auth {header, format}` hint. Error codes beyond TV-06: `invalid_token`, `insufficient_scope`, `provider_unavailable`, `invalid_request`, `not_found`, `internal_error`.
- **Connector `settings`:** auth-type-specific connector fields live under one `settings` object, validated by the handler's `definitionSchema`. This was chosen over a per-type top-level key, so new auth types (EX-04) need no schema change.
- **Defaults and placement:** connectors are enabled unless `hub.connectors.<id>.enabled: false`, which keeps CN-04 a one-file change. Handler helpers (`HandlerError`, templating, test request, `interfaceErrors`) live in `core/extension.js`; handlers import core, never the reverse.

## 2026-10-24 — Hub foundation choices (Phase 2; Q5, Q8 user choice)
- **Q8:** `postgres` (porsager, zero transitive deps) is the driver. The Hub UI will use Vite + `@vitejs/plugin-vue` + Tailwind v4.
- **Q5:** `schema_migrations` has no `tenant_id` (runner metadata).
- **Vault format:** one `sealed` bytea per row plus a `key_version` column, instead of separate IV/tag/DEK columns. It's less schema, and re-encryption is one generic query per table.
- **Container networking:** `LOGTO_INTERNAL_ENDPOINT` for server-to-server Logto calls, keeping the public issuer. This was chosen over changing the issuer hostname, which would invalidate tokens and redirect URIs.
- **Key-rotation test (ID-10) is opt-in** (`TEST_ROTATE_KEYS=1`). Rotating real keys can drop old ones permanently.

## 2026-10-24 — Phase 1 defaults for build-plan Q6, Q7, Q11, Q13 (user choice)
- **Q6:** Roles are assigned by config through `roleAssignments[]`, with emails from env (`OWNER_EMAILS`), so no PII is in git. The Console stays for ad-hoc assignment.
- **Q7:** Lockout is `sentinelPolicy {maxAttempts: 5, lockoutDuration: 15}` (minutes).
- **Q11:** Provision gives `isDefault` roles to existing users that have no roles.
- **Q13:** Logto's TTL-gated rotation (confidential clients rotate after 70% of TTL) satisfies ID-09.

## 2026-10-23 — Email: AWS SES or Cloudflare relay; SMTP removed (user choice)
EM-01 picks `aws-ses-mail` or `http-email` → Cloudflare relay through a config `email.provider`. The SMTP connector entry is removed. The `http-email` dev fallback to `scripts/dev-mailbox.js` stays.
