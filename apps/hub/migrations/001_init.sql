-- Hub schema v1 (build plan §3.2). Every table leads its primary key with tenant_id (NF-03).
-- `sealed` columns hold vault envelopes (VA-02); `key_version` drives `npm run hub:reencrypt`.

create table connections (
  tenant_id text not null default 'default',
  id uuid not null default gen_random_uuid(),
  sub text not null,
  connector_id text not null,
  label text not null,
  status text not null check (status in ('active', 'needs_reauth', 'revoked', 'error')),
  base_url text,
  access_expires_at timestamptz,
  provider_account_id text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_refreshed_at timestamptz,
  primary key (tenant_id, id)
);
create index connections_sub_idx on connections (tenant_id, sub);

create table connection_secrets (
  tenant_id text not null default 'default',
  connection_id uuid not null,
  key_version text not null,
  sealed bytea not null,
  primary key (tenant_id, connection_id),
  foreign key (tenant_id, connection_id) references connections (tenant_id, id) on delete cascade
);
create index connection_secrets_key_version_idx on connection_secrets (key_version);

create table consent_grants (
  tenant_id text not null default 'default',
  id uuid not null default gen_random_uuid(),
  sub text not null,
  client_id text not null,
  connection_id uuid not null,
  granted_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, client_id, connection_id),
  foreign key (tenant_id, connection_id) references connections (tenant_id, id) on delete cascade
);
create index consent_grants_sub_idx on consent_grants (tenant_id, sub);

-- Pending connector OAuth flows (10-minute TTL). `sealed` holds the PKCE verifier.
create table oauth_states (
  tenant_id text not null default 'default',
  state_hash text not null,
  sub text not null,
  connector_id text not null,
  connection_id uuid,
  label text,
  return_to text,
  key_version text not null,
  sealed bytea not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, state_hash)
);
create index oauth_states_key_version_idx on oauth_states (key_version);

-- Hub UI sessions (NF-02). sid_hash = sha256(cookie value); data is vault-sealed.
create table sessions (
  tenant_id text not null default 'default',
  sid_hash text not null,
  key_version text not null,
  sealed bytea not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, sid_hash)
);
create index sessions_expires_idx on sessions (expires_at);
create index sessions_key_version_idx on sessions (key_version);

-- Append-only audit log (AU-02, AU-03). No foreign keys: entries outlive connections.
create table audit_log (
  tenant_id text not null default 'default',
  id bigint generated always as identity,
  at timestamptz not null default now(),
  sub text,
  client_id text,
  connection_id uuid,
  ip inet,
  user_agent text,
  event_type text not null,
  result text not null check (result in ('success', 'failure')),
  error_code text,
  detail jsonb not null default '{}',
  primary key (tenant_id, id)
);
create index audit_log_at_idx on audit_log (tenant_id, at);
create index audit_log_sub_idx on audit_log (tenant_id, sub);
create index audit_log_event_idx on audit_log (tenant_id, event_type);
create index audit_log_client_idx on audit_log (tenant_id, client_id);

create function audit_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end
$$;
create trigger audit_log_no_update_delete before update or delete on audit_log
  for each row execute function audit_log_append_only();
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function audit_log_append_only();
