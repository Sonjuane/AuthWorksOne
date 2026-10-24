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
