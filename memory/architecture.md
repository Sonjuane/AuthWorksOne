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
- **Sample apps** — `apps/sample-rp` (:3010) and `apps/profile-app` (:3020), both Node servers built on shared `apps/lib/oidc.js` (openid-client wrapper: PKCE, state/nonce, JWKS verify, refresh-grant resource tokens, RP-initiated logout) and `apps/lib/web.js` (router + in-memory cookie sessions + HTML).
- **Dev mailbox** — `scripts/dev-mailbox.js` (:3099) receives `http-email` connector POSTs so email sign-up works without SMTP.

## Invariants

- Apps never read Logto Admin state directly; everything flows through `sso.config.json` → `npm run provision`.
- Client credentials live only in `.env.apps` (generated, git-ignored); human-managed secrets only in `.env` (git-ignored).
- Custom claim keys are declared once (`customJwtClaims.fromCustomData`); the JWT-customizer script is generated from them (`scripts/lib/jwt-script.js`) — never hand-edited in the Console.
- Access tokens for API resources are JWTs (ES384 `at+jwt`) verified against `/oidc/jwks`; the default no-resource access token is opaque and is what the Account API and `userinfo` accept.
