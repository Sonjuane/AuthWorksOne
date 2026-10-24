---
type: decision-log
title: Decisions
description: ADR-style log of significant technical decisions and their rationale.
last_updated: 2026-10-23
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

## 2026-10-23 — Email: AWS SES or Cloudflare relay; SMTP removed (user choice)
EM-01 picks `aws-ses-mail` or `http-email` → Cloudflare relay through a config `email.provider`. The SMTP connector entry is removed. The `http-email` dev fallback to `scripts/dev-mailbox.js` stays.
