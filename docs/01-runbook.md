# Runbook

Operational procedures for the AuthWorksOne Logto deployment. All commands run from the repo root.

## 1. First deploy

```sh
cp .env.example .env    # set POSTGRES_PASSWORD (openssl rand -hex 16)
npm install
npm run up
curl -fsS http://localhost:3001/oidc/.well-known/openid-configuration | head -c 200
```

Postgres data persists in the `pgdata` Docker volume. `docker compose down` keeps it; `docker compose down -v` destroys it.

## 2. One-time bootstrap (admin + Management API M2M)

Required once per fresh database, before `npm run provision` works.

1. Open `http://localhost:3002` → **Create account** → set the admin username/password. Store them (password manager or `.env` `LOGTO_ADMIN_*` for dev).
2. Console → **Applications** → **Create application** → filter **Machine-to-machine** → **Create app without framework** → name it `Provisioner (Management API)`.
3. In the create flow, assign the role **Logto Management API access** (must show 1 role assigned).
4. On the app's settings page, reveal the **Default secret** value.
5. In `.env`, set `LOGTO_M2M_CLIENT_ID=<App ID>` and `LOGTO_M2M_CLIENT_SECRET=<Default secret>`.
6. Verify: `npm run provision` completes and prints the issuer.

## 3. Add or change a client app (standard onboarding)

1. Edit `applications` in `config/sso.config.json`: unique `key`, `name` (provision matches by name; renaming creates a new app), `type` (`Traditional` | `SPA` | `Native` | `MachineToMachine`), exact `redirectUris` and `postLogoutRedirectUris` (wildcards fail schema validation), `customClientMetadata` (`rotateRefreshToken`, `refreshTokenTtlInDays`), and for Hub callers a `hub` block (`allowedConnectors`, `consentReturnUris`). Add `profiles: ["test"]` for test-only apps.
2. `npm run provision` — creates or updates the app and writes `<KEY>_CLIENT_ID` / `<KEY>_CLIENT_SECRET` to `.env.apps`. `SSO_PROFILE=test npm run provision` also applies `profiles: ["test"]` entries.
3. Hand the app team: issuer URL (`$LOGTO_ENDPOINT/oidc`), client ID, client secret. They need nothing else — discovery supplies all endpoints. Require PKCE + `state`/`nonce` in their client.
4. Scopes: `openid profile email` baseline; add `custom_data` for mapped profile fields, `offline_access` (+ `prompt=consent`) for refresh tokens, `resource=<indicator>` for JWT access tokens.

Provision output legend: `+` created, `=` exists/updated, `-` skipped (with reason). Re-running is safe.

## 4. Connectors

- **Google Workspace**: create an OAuth client in Google Cloud Console (redirect URI `$LOGTO_ENDPOINT/callback/google-universal`; for Workspace-only audiences choose *Internal*). Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env` → `npm run provision`. The `google` button appears on the sign-in page automatically.
- **GitHub**: create a GitHub OAuth app (callback URI as shown in Console → Connectors → GitHub, `$LOGTO_ENDPOINT/callback/<connector id>`). Set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` → `npm run provision`. The `github` button appears automatically.
- **Email (config `email`)**: one Email connector, chosen by `EMAIL_PROVIDER` or `email.provider` (`ses` | `cloudflare`).
  - **AWS SES**: set `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET`, `AWS_SES_REGION`, `AWS_SES_FROM` → `npm run provision`. Expect `+ aws-ses-mail (ses)` and `- http-email (removed …)`. Templates come from `email.templates` (SignIn, Register, ForgotPassword, Generic are all required).
  - **Cloudflare**: `EMAIL_PROVIDER=cloudflare`, `EMAIL_RELAY_URL`, `EMAIL_RELAY_TOKEN`. The relay is not built yet (build plan Q1).
  - **Dev fallback**: with the chosen provider's env incomplete, provision logs `- <provider> (env vars not set …)` and applies `http-email` → compose `mailbox` service (`http://mailbox:3099/email`, started by `npm run up`). Read codes with `npm run mailbox` or `GET http://localhost:3099/`. Dev/test only; never expose it.

## 4a. Roles, permissions, and webhooks

- **Roles**: `roles[]` with `permissions` (resource indicator + scope names declared under `resources[].scopes`). `isDefault: true` roles go to new users; provision also gives them to existing users that have no roles (`+ default role(s) given to N existing user(s)`).
- **Assign a role by config**: list emails (comma-separated) in the env var named by `roleAssignments[].emailsEnv` (e.g. `OWNER_EMAILS`) → `npm run provision` → `+ owner -> <email>`. The user's next token carries it (`roles` claim). Ad-hoc assignment stays in the Console (owner only).
- **Webhooks**: `hooks[]` (`name`, `events`, `url`, `enabled`). Provision writes the signing key to `.env.apps` (`signingKeyEnvOut`). `Hub: user deleted` stays `enabled: false` until the Hub's webhook endpoint exists (build plan task 5.4).
- **Console rule (AD-01, AD-02)**: only the owner uses the Admin Console. Never edit in the Console anything provision manages (resources, roles, apps, connectors, sign-in experience, account center, JWT customizer, hooks); provision overwrites it.
- **Verify after changes or before a Logto upgrade**: `npm run verify:logto` and `npm run test:int`.

## 4b. Connector Hub (apps/hub)

First run (after §2 bootstrap and `npm run provision`, which writes `HUB_UI_*` and `HUB_WEBHOOK_SIGNING_KEY` to `.env.apps`):

```sh
# .env: HUB_DB_PASSWORD (openssl rand -hex 16), HUB_DATABASE_URL, HUB_MASTER_KEYS=v1:$(openssl rand -base64 32),
#       HUB_MASTER_KEY_CURRENT=v1, HUB_BASE_URL — see .env.example
npm run hub:db:init     # + role hub, + database hub (idempotent; re-syncs the role password)
npm run hub:migrate     # + 001_init.sql … (idempotent)
npm run up              # compose `hub` service on :3030 (or `npm run hub` on the host — not both)
```

- **Startup refusal**: missing secrets, a non-https `HUB_BASE_URL` with `NODE_ENV=production`, or pending migrations → JSON log `startup_failed` with the reason, exit 1. The compose service restarts until fixed.
- **Health**: `GET /health` → `{ meta, data: { status: "ok" } }` (checks the database). API document: `GET /openapi.json`; tools list: `GET /v1/manifest`.
- **Sign-in**: `GET /login` → Logto → `/callback` (Hub UI app `hub-ui`; redirect URI `$HUB_BASE_URL/callback`); `GET /logout` ends the Logto session.
- **Connect a provider**: OAuth connectors via `GET /connect/start?connector=<id>&label=<label>` (re-authorize: `?connectionId=<id>`); provider callback URI to register: `$HUB_BASE_URL/connect/callback`. Form connectors (WordPress) via `POST /ui-api/connections` with the `x-csrf-token` from `GET /ui-api/session`. The credential test must pass before anything is stored.
- **SSRF guard**: user-entered URLs must be https and resolve to public addresses. `HUB_ALLOW_PRIVATE_URLS=1` (dev/test only; refused with `NODE_ENV=production`) allows http and local hosts, e.g. the mock provider.
- **Connection states**: `active` → `needs_reauth` when a refresh is rejected (`last_error_code`); the user re-authorizes from `reconnectUrl`. Expired sessions/OAuth states are purged hourly (`expired_purged` log).
- **App API** (bearer Logto token for `https://hub.authworks.local`): `GET /v1/connections` (`connections:read`) and `POST /v1/credentials {connectionId | connectorId, returnTo?}` (`connections:token`); contract in `GET /openapi.json`. Apps must be listed with a `hub` block in `config/sso.config.json` (`client_not_registered` otherwise). On `consent_required`, send the user to `error.consentUrl`; on `connection_reauth_required`, to `error.reconnectUrl`.
- **User deletion (VA-08)**: the Logto hook `Hub: user deleted` posts to `http://hub:3030/webhooks/logto`, signed with `HUB_WEBHOOK_SIGNING_KEY` (re-run `npm run provision` and restart the Hub if the key changes). Logto 1.45 blocks webhooks to private addresses, so the compose `logto` service allows only `COMPOSE_SUBNET`. Production alternative: point the hook at the Hub's public HTTPS URL.
- **Reconcile (missed webhooks)**: `npm run hub:reconcile -- --dry-run` lists Hub users missing from Logto (`- would remove …`); without `--dry-run` it removes them (`+ removed …`). It refuses when Logto returns no users or >20% would be removed (`--force` overrides). Run it after Hub downtime, or daily from cron on the host. It uses the provisioner M2M credentials from `.env`.
- **Identity audit (AU-01)**: logins, 2FA set-up during sign-in, and account linking are in Logto Console → Audit logs (`GET /api/logs`). Account Center changes are not logged (spec §8). Hub events (connections, consents, credential issuance, rejected API calls) are in `audit_log` (Hub admin view, task 6.5).
- **Connectors**: the `started` log lists loaded `authTypes` and `connectors`. A connector without its client env logs `connector_skipped {id, missingEnv}`; an invalid definition stops startup with `startup_failed … Invalid Hub extensions` and the file + reason. Add or change one with [docs/03-hub-extensions.md](03-hub-extensions.md).
- **Container networking**: the compose `hub` uses `postgres:5432` and fetches JWKS from `LOGTO_INTERNAL_ENDPOINT=http://logto:3001`; token `iss` stays `LOGTO_ENDPOINT`.
- **Master keys**: back up `HUB_MASTER_KEYS` with `.env`. Losing a key version makes every record sealed with it unreadable. Rotate by adding `v2:<key>`, setting `HUB_MASTER_KEY_CURRENT=v2`, restarting the Hub, and running `npm run hub:reencrypt` (`+ <table>: N row(s)`). Remove `v1` only after a second run reports `= <table>: 0 rows` for every table.
- **Backup**: `docker compose exec postgres pg_dump -U logto -Fc hub > backup/hub-$(date +%F).dump` (same restore steps as §6, database `hub`).

## 5. Rotate OIDC signing keys

```sh
npm run rotate-keys                 # new EC key; old key stays in JWKS (grace period)
npm run rotate-keys -- --alg RSA    # RSA instead
npm run rotate-keys -- --cookie     # rotate cookie keys
```

New tokens sign with the new key immediately; keep the old key until all access tokens issued under it have expired (default TTL 1 h). Then delete it:

```sh
# list: GET /api/configs/oidc/private-keys ; delete: DELETE /api/configs/oidc/private-keys/{id}
node --env-file=.env -e "import('./scripts/lib/logto.js').then(async ({api}) => console.log(await api('GET','/api/configs/oidc/private-keys')))"
node --env-file=.env -e "import('./scripts/lib/logto.js').then(({api}) => api('DELETE','/api/configs/oidc/private-keys/<OLD_KEY_ID>'))"
```

Verify consumers still validate: `curl -fsS $LOGTO_ENDPOINT/oidc/jwks`.

## 6. Backup / restore

```sh
# backup (hot)
docker compose exec postgres pg_dump -U logto -Fc logto > backup/logto-$(date +%F).dump

# restore (fresh volume)
docker compose down -v && docker compose up -d postgres
sleep 5
docker compose exec -T postgres pg_restore -U logto -d logto --clean --if-exists < backup/logto-<DATE>.dump
docker compose up -d
```

Also back up `.env` (contains the only copy of the M2M credentials and Postgres password). `.env.apps` is regenerable via `npm run provision`.

## 7. Secrets & production promotion

- Local dev: secrets live in `.env` / `.env.apps` (both git-ignored).
- Production: inject the same variables from your secret store (1Password, Vault, Doppler, cloud SM) at deploy time; do not ship `.env` files.
- HTTPS issuer: front Logto with a TLS proxy (Caddy/Traefik/nginx), then set in `.env`:
  - `LOGTO_ENDPOINT=https://auth.yourdomain.com`
  - `LOGTO_ADMIN_ENDPOINT=https://auth-admin.yourdomain.com`
  - `TRUST_PROXY_HEADER=1` is already set in compose.
- After changing the endpoint: restart (`npm run up`), re-run `npm run provision`, update every client's issuer URL, and update Google's redirect URI.
- Changing the issuer invalidates existing sessions/tokens; schedule accordingly.
- Restrict `:3002` (Admin Console) to internal networks/VPN. Keep audit logs (Console → Audit logs) in your log retention plan.

## 8. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Token exchange 401 `invalid_client` | Client secret mismatch. Secrets must come from `GET /api/applications/{id}/secrets` (the `application_secrets` store); the legacy `secret` field on the application object does not authenticate. `npm run provision` handles this — re-run it and restart apps. |
| Provision 400 `passwordless_requires_verify` | Email is a sign-up identifier but no Email connector exists. Check the `Email` step of the provision output: the chosen provider needs complete env, otherwise `email.devFallback` applies. |
| Provision 400 `custom_profile_fields.invalid_name` | Field names must be strictly alphanumeric (`displayName`, not `display_name`). |
| Sign-up code never arrives (dev) | Compose `mailbox` service not running (`npm run up` starts it with the `dev` profile; `docker compose ps mailbox`), or provision chose a real provider (check the `Email` step). |
| Scripted sign-in fails with `user.suggest_mfa` | MFA policy prompts at sign-in. Skip with `POST /api/experience/profile/mfa/mfa-skipped` (handled by `scripts/lib/experience.js`). |
| Hub log `startup_failed … Logto discovery failed` | Logto not reachable from the Hub. Compose: `LOGTO_INTERNAL_ENDPOINT=http://logto:3001` and Logto running; host: `LOGTO_ENDPOINT` reachable. The compose service retries until Logto is up. |
| Connect redirect ends with `?connect_error=<code>` | `invalid_state` (flow expired after 10 min or replayed: start again), `provider_denied` (user declined / code exchange failed), `connection_test_failed` (provider rejected the credential), `invalid_input` (URL refused by the SSRF guard), `connector_not_available` (disabled or env missing). |
| Deleting a Logto user leaves Hub connections | Webhook not delivered: Console → Webhooks → `Hub: user deleted` → recent deliveries. `fetch failed` means the compose network isn't `COMPOSE_SUBNET` (run `docker compose down && npm run up` once) or the Hub is down. `invalid_signature` in the Hub log means the signing key is out of sync (`npm run provision`, restart the Hub). Then run `npm run hub:reconcile`. |
| Hub log `startup_failed … pending migrations` | Run `npm run hub:migrate` (after `npm run hub:db:init` on a fresh volume). |
| Hub log `startup_failed … Missing required env vars` | Set the listed vars in `.env`; `HUB_UI_*` / `HUB_WEBHOOK_SIGNING_KEY` come from `npm run provision` (`.env.apps`). |
| `npm run hub` fails with `EADDRINUSE :3030` | The compose `hub` service is running; stop it (`docker compose stop hub`) or use it instead. |
| `npm run verify:logto` LV-01 fails to reach the mock IdP | Logto calls the in-process mock at `host.docker.internal:3098`. Linux: add `extra_hosts: ["host.docker.internal:host-gateway"]` to the `logto` service. |
| `/account/profile` returns Page not found | Logto 1.41 ships security/email/username/password pages only; profile + custom fields editing is covered by the profile app (`:3020`). Re-check after image upgrades. |
| Custom claims missing from access token | Claims apply only to resource-bound JWT access tokens (request with `resource=`); the default opaque token shows claims via `userinfo` `custom_data` instead. Check Console → Custom JWT for script errors. |
| M2M token 401 | `LOGTO_M2M_CLIENT_*` wrong or the app lost the **Logto Management API access** role (Console → Applications → Provisioner → Roles). |
