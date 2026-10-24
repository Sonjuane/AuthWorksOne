---
type: pitfall-registry
title: Gotchas & Edge Cases
description: Non-obvious pitfalls, edge cases, and traps discovered while working in this codebase.
last_updated: 2026-10-24
---

# Gotchas

## Phase 0 verification results (spec §3.0) — Logto 1.41.0 (2026-10-23), re-run on 1.45.0 (2026-10-24)
Live probes against the local tenant (Management, Experience, and Account APIs, plus a mock OIDC IdP for LV-01). Every probe change was reverted and every entity it created was deleted. 1.45.0 gave identical results for all nine items. Its new log families (`Action.*`, `TrustedDevice.*`) do not cover Account API changes.

| ID | Result | Evidence / config surface |
|---|---|---|
| LV-01 | PASS | `signInExperience.socialSignIn.automaticAccountLinking: true`. Two generic `oidc` connectors with the same verified email resolved to one user; an unverified email returned no `relatedUser` and did not link. |
| LV-02 | PASS | `mfa.factors: ["Totp","BackupCode"]`. Enroll/remove via Account API (`POST/DELETE /api/my-account/mfa-verifications`) and in the sign-in flow (`user.missing_mfa` → bind → submit). Sign-in with TOTP and with a backup code both work. |
| LV-03 | PASS (partial) | Policies: `Mandatory`, `PromptAtSignInAndSignUp`, `PromptOnlyAtSignIn`, `NoPrompt` (`UserControlled` deprecated). Per-organization enforcement exists (`organizations.isMfaRequired`, `mfa.organizationRequiredMfaPolicy`). **No per-role enforcement.** |
| LV-04 | PASS | `GET /api/my-account/sessions` and `DELETE /api/my-account/sessions/{payload.uid}` (3 → 2 sessions). Account Center SPA has a `/sessions` page. Needs `accountCenter.fields.session` and scope `urn:logto:scope:sessions`. |
| LV-05 | PASS | `signInExperience.sentinelPolicy: {maxAttempts, lockoutDuration}` (minutes). Blocked attempts return `session.verification_blocked_too_many_attempts`, including the correct password during lockout. |
| LV-06 | PASS (gap) | `GET /api/logs` with `userId`, `logKey`, `page`, `page_size` (≤100). Keys: `Interaction.*` (sign-in, register, forgot password, MFA bind/verify, social verify, `Profile.Update` on sign-in linking), `ExchangeTokenBy.*`, `JwtCustomizer.*`. **Account API / Account Center changes (2FA enroll/remove, profile, identity link/unlink) are not audit-logged.** They only fire `User.Data.Updated` webhooks. |
| LV-07 | PASS | Per-app `customClientMetadata.rotateRefreshToken` and `refreshTokenTtlInDays` (default `{}`). Rotation semantics are below. |
| LV-08 | PASS | Resource JWT (`at+jwt`) carries `sub`, `client_id`, `aud`, and `scope` (only permissions granted through the user's roles). `roles` appears when the JWT customizer maps `context.user.roles[].name`. |
| LV-09 | PASS (http-email) / PENDING (SES) | http-email delivered Register and ForgotPassword codes; a full reset completed. `aws-ses-mail` factory present, but live send untested (no AWS credentials). |

## Logto automatic account linking runs in the hosted sign-in UI, not the server
`POST /api/experience/identification` returns `422 user.identity_not_exist` with `data.relatedUser` even when `automaticAccountLinking` is on. The hosted UI then re-calls identification with `linkSocialIdentity: true`. Custom sign-in UIs or API-driven tests must do the same.

## Generic OIDC connector ignores unverified emails
`connector-oidc` takes `email` only when `email_verified` is true (or `trustUnverifiedEmail` is set). Mock IdPs must emit `email_verified: true` for linking tests.

## Forgot-password needs `forgotPasswordMethods`
The tenant default is `[]`, which makes `identification` fail with `session.not_supported_for_forgot_password`. Set `signInExperience.forgotPasswordMethods: ["EmailVerificationCode"]`.

## Account API MFA and session routes need extra scopes and Account Center fields
MFA routes need OIDC scope `identities` and `accountCenter.fields.mfa`. Session routes need `urn:logto:scope:sessions` and `accountCenter.fields.session`. Writes need a verification record (`POST /api/verifications/password` → `logto-verification-id` header). Missing scope → `401 auth.unauthorized`.

## Refresh-token rotation for confidential clients is TTL-gated
With `rotateRefreshToken: true`, public clients (`clientAuthMethod: none`) rotate on every use. Confidential clients rotate only after 70% of the token's TTL has passed, so reusing an old refresh token earlier still succeeds. PKCE is required unless the client uses `client_secret_basic`.

## Resource scopes in access tokens come only from roles
A requested resource scope appears in `scope` only if one of the user's roles grants it. Hub scopes (`connections:read`, `connections:token`) need a default `user` role that carries them.

## Optional MFA prompt surfaces as `user.suggest_mfa`
With a `Prompt*` MFA policy, `POST /api/experience/submit` for a user without MFA returns `422 user.suggest_mfa`, not `user.missing_mfa`. Skip it with `POST /api/experience/profile/mfa/mfa-skipped`, then submit again. `Mandatory` still returns `user.missing_mfa`, which can't be skipped.

## Webhook signing key is a field on the hook
`GET /api/hooks/{id}` returns `signingKey`. `/api/hooks/{id}/signing-key` only accepts `PATCH`, which regenerates the key, and returns 405 on GET.

## Management-API-created users get default roles
`POST /api/users` applies `isDefault` roles, the same as self sign-up. Only users created before a role became default lack it (provision backfills users with zero roles).

## Containers can't use the public issuer URL for server-to-server calls
`LOGTO_ENDPOINT=http://localhost:3001` is the token `iss` and the browser URL, but `localhost` inside a container is the container itself. Fetch the JWKS (and later token endpoints) via `LOGTO_INTERNAL_ENDPOINT=http://logto:3001`, while still validating `iss` against the public issuer.

## Signing-key rotation can permanently drop old keys
`POST /api/configs/oidc/private-keys/rotate` keeps only keys within `rotationGracePeriod`. Rotating when 2 keys already exist can remove the oldest one, and deleted keys can't be restored. That's why the ID-10 integration test is opt-in.

## `GET /api/logs` page size limit
`page_size` above 100 → `400 guard.invalid_pagination`. Page with `page=N`.

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
