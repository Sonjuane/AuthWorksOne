---
type: pattern-registry
title: Patterns & Anti-Patterns
description: Reusable patterns and anti-patterns established in this codebase.
last_updated: 2026-07-07
---

# Patterns

## Idempotent provisioner with `+ / = / -` logging
Every section of `scripts/provision.js` GETs current state, then POSTs (create) or PATCHes (update), logging `+` created, `=` exists/updated, `-` skipped with reason. Re-running is always safe. New tenant config belongs in `sso.config.json` + a provision section, never in ad-hoc scripts.

## Secrets via env indirection in config
Connector entries map config fields to env var names (`configEnv: {clientId: "GOOGLE_CLIENT_ID"}`); the JSON stays commit-safe and the connector is skipped (with a log line) when env is unset.

## `devFallback` connectors
A connector marked `devFallback: true` is applied only while no other connector of its type exists, and is deleted automatically once a real one is provisioned. Use for any dev stand-in that must never survive into production config.

## Generated-not-authored Logto extension scripts
The JWT-customizer script is generated from `customJwtClaims.fromCustomData` by `scripts/lib/jwt-script.js`. Anti-pattern: editing the script in the Admin Console (provision overwrites it).

## Shared RP helper for every internal app
Any new internal app should consume `apps/lib/oidc.js` + `apps/lib/web.js` rather than re-implementing PKCE/session plumbing. External teams get issuer + client ID/secret and use their own certified OIDC client.
