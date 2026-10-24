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

1. Edit `applications` in `config/sso.config.json`: unique `key`, `name`, `type` (`Traditional` | `SPA` | `Native` | `MachineToMachine`), exact `redirectUris` and `postLogoutRedirectUris`.
2. `npm run provision` — creates or updates the app and writes `<KEY>_CLIENT_ID` / `<KEY>_CLIENT_SECRET` to `.env.apps`.
3. Hand the app team: issuer URL (`$LOGTO_ENDPOINT/oidc`), client ID, client secret. They need nothing else — discovery supplies all endpoints. Require PKCE + `state`/`nonce` in their client.
4. Scopes: `openid profile email` baseline; add `custom_data` for mapped profile fields, `offline_access` (+ `prompt=consent`) for refresh tokens, `resource=<indicator>` for JWT access tokens.

Provision output legend: `+` created, `=` exists/updated, `-` skipped (with reason). Re-running is safe.

## 4. Connectors

- **Google Workspace**: create an OAuth client in Google Cloud Console (redirect URI `$LOGTO_ENDPOINT/callback/google-universal`; for Workspace-only audiences choose *Internal*). Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env` → `npm run provision`. The `google` button appears on the sign-in page automatically.
- **SMTP (production email)**: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` → `npm run provision`. This also deletes the dev `http-email` fallback connector.
- **Dev fallback**: without SMTP, sign-up codes go to the `http-email` connector pointed at `npm run mailbox` (`http://host.docker.internal:3099/email`). Dev only — never expose it.

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
| Provision 400 `passwordless_requires_verify` | Email is a sign-up identifier but no Email connector exists. Set `SMTP_*` or keep the `http-email` dev fallback and run `npm run mailbox`. |
| Provision 400 `custom_profile_fields.invalid_name` | Field names must be strictly alphanumeric (`displayName`, not `display_name`). |
| Sign-up code never arrives (dev) | `npm run mailbox` not running, or Docker cannot resolve `host.docker.internal` (Linux: add `extra_hosts: ["host.docker.internal:host-gateway"]` to the `logto` service). |
| `/account/profile` returns Page not found | Logto 1.41 ships security/email/username/password pages only; profile + custom fields editing is covered by the profile app (`:3020`). Re-check after image upgrades. |
| Custom claims missing from access token | Claims apply only to resource-bound JWT access tokens (request with `resource=`); the default opaque token shows claims via `userinfo` `custom_data` instead. Check Console → Custom JWT for script errors. |
| M2M token 401 | `LOGTO_M2M_CLIENT_*` wrong or the app lost the **Logto Management API access** role (Console → Applications → Provisioner → Roles). |
