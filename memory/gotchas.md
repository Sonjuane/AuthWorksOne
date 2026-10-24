---
type: pitfall-registry
title: Gotchas & Edge Cases
description: Non-obvious pitfalls, edge cases, and traps discovered while working in this codebase.
last_updated: 2026-07-07
---

# Gotchas

## Legacy application `secret` field does not authenticate
`POST /api/applications` returns a `secret` field, but token-endpoint auth validates against the `application_secrets` store (`GET /api/applications/{id}/secrets`, auto-created "Default secret"). Using the legacy field yields `401 invalid_client`. Provision reads the secrets endpoint.

## Custom profile field names are strictly alphanumeric
`display_name` → `400 custom_profile_fields.invalid_name`. Use camelCase (`displayName`). The name doubles as the customData key and the JWT claim name.

## Email sign-up identifier hard-requires an Email connector
`PATCH /api/sign-in-exp` rejects `signUp.verify: false` for email identifiers (`passwordless_requires_verify`), and verification needs a connector. There is no mock email connector in the production OSS image — the `http-email` factory + local mailbox is the dev workaround.

## Logto 1.41 Account Center has no `/account/profile` page
Only security/email/username/password pages exist; the docs describe a newer version. Custom fields are still editable via Account API (`PATCH /api/my-account` with `customData`) — that PATCH replaces `customData` wholesale, so merge client-side first.

## Opaque vs JWT access tokens
No `resource` in the request → opaque token (works for `userinfo` and Account API). With `resource` → JWT for that audience only. To hold both, request `offline_access` (+ `prompt=consent`) and mint the resource JWT via refresh grant.

## openid-client v6 refuses plain-HTTP issuers
Local `http://localhost:3001/oidc` needs `client.allowInsecureRequests` in the discovery `execute` option — handled in `apps/lib/oidc.js`, applied only when the issuer starts with `http://`.

## Docker-to-host callbacks on macOS/Linux
The `http-email` connector calls `host.docker.internal:3099`. Works out of the box on Docker Desktop (macOS/Windows); on Linux add `extra_hosts: ["host.docker.internal:host-gateway"]`.
