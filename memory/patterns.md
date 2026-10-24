---
type: pattern-registry
title: Patterns & Anti-Patterns
description: Reusable patterns and anti-patterns established in this codebase.
last_updated: 2026-10-24
---

# Patterns

## Scripted sign-ins through the Experience API
`scripts/lib/experience.js` drives Logto the way the hosted sign-in page does: cookie-jar browser, PKCE authorize, password/MFA/social steps, code exchange, Account API calls. `scripts/lib/mock-oidc.js` is an in-process OIDC IdP for generic-connector tests. Reuse both in verification and tests; don't hand-roll interaction flows. `scripts/verify-logto.js` is the reference consumer: per-check snapshot → run → restore + deferred cleanup, then a final tenant-drift check.

## Idempotent provisioner with `+ / = / -` logging
Every section of `scripts/provision.js` GETs current state, then POSTs (create) or PATCHes (update), logging `+` created, `=` exists/updated, `-` skipped with reason. Re-running is always safe. New tenant config belongs in `sso.config.json` + a provision section, never in ad-hoc scripts.

## Secrets via env indirection in config
Connector entries map config fields to env var names (`configEnv: {clientId: "GOOGLE_CLIENT_ID"}`); the JSON stays commit-safe and the connector is skipped (with a log line) when env is unset.

## `devFallback` email connector
`email.devFallback` (http-email → compose `mailbox`) is applied only while the selected `email.provider` lacks env. Once the provider's env is complete, provision applies the real connector and deletes every other Email connector. Use the same shape for any dev stand-in that must never survive into production config.

## `profiles` for environment-specific entries
`connectors[]` and `applications[]` entries tagged `profiles: ["test"]` apply only when `SSO_PROFILE` matches (default `dev`). Provision logs `- <name> (profile test)` otherwise. Mock login connectors and test-only clients live here, never in separate config files.

## Generated-not-authored Logto extension scripts
The JWT-customizer script is generated from `customJwtClaims.fromCustomData` by `scripts/lib/jwt-script.js`. Anti-pattern: editing the script in the Admin Console (provision overwrites it).

## Sealed rows with AAD (Hub)
Store secrets only as `vault.seal(value, \`${tenantId}|${table}|${rowId}\`)` in a `sealed bytea` column plus `key_version`. Open with the same AAD, so a blob copied to another row fails to decrypt. Hash bearer identifiers (session IDs, OAuth state) before using them as keys. Anti-pattern: separate IV/tag/DEK columns, or plaintext tokens in any column or session.

## Extension modules are files in a directory (Hub)
New connector: one JSON file in a connector directory. New auth type: one JS module default-exporting the handler, plus a fixture in `test/contract/fixtures.js`. Files starting with `_` are templates and are never loaded. Prove it with `npm run test:contract`; a handler without a fixture fails. Anti-pattern: `if (connector.id === 'x')` anywhere in `apps/hub/core/`. Express provider quirks as `settings` fields, or as a new auth type.

## Integration tests leave no trace
Tests against the live tenant/DB create throwaway users/rows and delete them in `after()`. Append-only tables are exercised inside a transaction that is rolled back on purpose. Mutations that can't be undone (e.g. signing-key rotation) are opt-in by env flag. Service-level tests run as tenant `itest`, so their audit rows (append-only by design) stay out of `default`. Live tests against the compose Hub delete their own session rows; their audit entries remain, as real audit events should.

## Mutation-check guards before trusting a green test
For safety properties (no refresh-token leak, single refresh under concurrency), temporarily break the guard and confirm the test fails, then restore the guard. Both the contract suite and the refresh-lock test were verified this way. The lock test only became meaningful after adding a slow-provider control.

## Shared RP helper for every internal app
Any new internal app should consume `apps/lib/oidc.js` + `apps/lib/web.js` rather than re-implementing PKCE/session plumbing. External teams get issuer + client ID/secret and use their own certified OIDC client.
