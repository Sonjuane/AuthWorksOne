---
type: domain-glossary
title: Domain Glossary
description: Domain concepts, terminology, and their meanings in this project.
last_updated: 2026-07-07
---

# Domain

- **Issuer** — `$LOGTO_ENDPOINT/oidc`; the only URL a relying party needs besides its credentials (discovery supplies the rest).
- **Relying party (RP)** — any app that delegates login to the issuer. Samples: `sample-rp` (:3010), `profile-app` (:3020).
- **Management API** — admin-plane REST API (`/api/*` on :3001), authenticated by the M2M "Provisioner" app via client-credentials against resource `https://default.logto.app/api`, scope `all`.
- **Account API** — end-user self-service API (`/api/my-account`), authenticated by the user's opaque access token; per-field permissions set via `accountCenter.fields` in config.
- **Account Center** — Logto-hosted self-service pages under `$LOGTO_ENDPOINT/account`.
- **Custom profile fields** — sign-up-collected fields stored in user `customData` (here: `displayName`, `jobTitle`); exposed via the `custom_data` scope and mapped into resource JWT claims.
- **API resource** — audience for JWT access tokens; sample indicator `https://api.authworks.local`.
- **Dev mailbox** — local receiver (:3099) for the `http-email` fallback connector's verification emails; dev only.
- **Bootstrap** — the one-time manual Console step creating the admin user and the Provisioner M2M app (runbook §2).
