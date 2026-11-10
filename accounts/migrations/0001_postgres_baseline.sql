-- Postgres baseline for the accounts service: the forward translation of
-- cloudflare/control-plane/migrations/*.sql. The D1 files are untouched; this
-- is the schema a fresh Postgres starts from, so intermediate SQLite-only
-- steps (the dropped issuer column, the replaced capacity table) are folded.
-- Tunnel-only tables (installation_endpoints, managed_endpoint_capacity,
-- managed_endpoint_account_capacity) are not created. Epoch milliseconds stay
-- BIGINT; Better Auth datetimes are timestamptz.

CREATE TABLE "user" ("id" text NOT NULL PRIMARY KEY, "name" text NOT NULL, "email" text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL, "image" text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL);

CREATE TABLE "session" ("id" text NOT NULL PRIMARY KEY, "expiresAt" timestamptz NOT NULL, "token" text NOT NULL UNIQUE, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL, "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE);

CREATE TABLE "account" ("id" text NOT NULL PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL);

CREATE TABLE "verification" ("id" text NOT NULL PRIMARY KEY, "identifier" text NOT NULL, "value" text NOT NULL, "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL);

CREATE TABLE "rateLimit" ("id" text NOT NULL PRIMARY KEY, "key" text NOT NULL UNIQUE, "count" integer NOT NULL, "lastRequest" bigint NOT NULL);

CREATE INDEX "session_userId_idx" ON "session" ("userId");

CREATE INDEX "account_userId_idx" ON "account" ("userId");

CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");

CREATE TABLE installations (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  client_instance_id TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  platform TEXT NOT NULL CHECK (platform IN ('darwin', 'windows', 'linux')),
  app_version TEXT CHECK (app_version IS NULL OR length(app_version) BETWEEN 1 AND 64),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  last_seen_at BIGINT,
  last_rotation_at BIGINT,
  revoked_at BIGINT,
  relay_host_id TEXT,
  relay_blocked_at BIGINT
);

CREATE INDEX installations_owner_active_idx
  ON installations(owner_user_id, revoked_at, created_at);

CREATE UNIQUE INDEX installations_owner_client_active_uidx
  ON installations(owner_user_id, client_instance_id)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX installations_relay_host_id_uidx
  ON installations(relay_host_id)
  WHERE relay_host_id IS NOT NULL;

CREATE OR REPLACE FUNCTION installations_active_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COUNT(*) FROM installations
      WHERE owner_user_id = NEW.owner_user_id AND revoked_at IS NULL) >= 100 THEN
    RAISE EXCEPTION 'active_installation_limit';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER installations_active_limit_before_insert
BEFORE INSERT ON installations
FOR EACH ROW
WHEN (NEW.revoked_at IS NULL)
EXECUTE FUNCTION installations_active_limit();

CREATE OR REPLACE FUNCTION installations_rotation_cooldown() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'credential_rotation_rate_limited';
END;
$$;

CREATE TRIGGER installations_rotation_cooldown_before_update
BEFORE UPDATE OF last_rotation_at ON installations
FOR EACH ROW
WHEN (OLD.last_rotation_at IS NOT NULL
  AND NEW.last_rotation_at < OLD.last_rotation_at + 60000)
EXECUTE FUNCTION installations_rotation_cooldown();

CREATE TABLE installation_credentials (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  lookup_id TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL UNIQUE CHECK (length(secret_hash) = 64),
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  last_used_at BIGINT,
  revoked_at BIGINT
);

CREATE INDEX installation_credentials_installation_idx
  ON installation_credentials(installation_id, revoked_at);

CREATE UNIQUE INDEX installation_credentials_one_active_uidx
  ON installation_credentials(installation_id)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION installation_credentials_rotation_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM installation_credentials
      WHERE installation_id = NEW.installation_id)
    AND NOT EXISTS (SELECT 1 FROM installations
      WHERE id = NEW.installation_id
        AND revoked_at IS NULL
        AND last_rotation_at = NEW.created_at) THEN
    RAISE EXCEPTION 'credential_rotation_conflict';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER installation_credentials_rotation_guard_before_insert
BEFORE INSERT ON installation_credentials
FOR EACH ROW
EXECUTE FUNCTION installation_credentials_rotation_guard();

CREATE TABLE otp_recipient_rate_limits (
  recipient_key TEXT PRIMARY KEY CHECK (length(recipient_key) = 64),
  window_started_at BIGINT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  updated_at BIGINT NOT NULL
);

CREATE INDEX otp_recipient_rate_limits_updated_idx
  ON otp_recipient_rate_limits(updated_at);

CREATE TABLE control_action_rate_limits (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  window_started_at BIGINT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, action)
);

CREATE TABLE installation_action_rate_limits (
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  window_started_at BIGINT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (installation_id, action)
);

CREATE INDEX installation_action_rate_limits_updated_idx
  ON installation_action_rate_limits(updated_at);

CREATE TABLE installation_push_devices (
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL CHECK (length(token_hash) = 64),
  token TEXT NOT NULL CHECK (length(token) BETWEEN 64 AND 200),
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  last_sent_at BIGINT,
  PRIMARY KEY (installation_id, token_hash)
);

CREATE INDEX installation_push_devices_token_idx
  ON installation_push_devices(token_hash);

CREATE TABLE highlevel_flows (
  lookup TEXT PRIMARY KEY CHECK (length(lookup) = 64),
  ciphertext TEXT CHECK (ciphertext IS NULL OR length(ciphertext) BETWEEN 1 AND 65536),
  created_at BIGINT NOT NULL,
  claimed_at BIGINT,
  callback_at BIGINT,
  CHECK (claimed_at IS NULL OR ciphertext IS NULL)
);

CREATE INDEX highlevel_flows_created_idx
  ON highlevel_flows(created_at);

CREATE TABLE highlevel_ip_rate_limits (
  ip_key TEXT NOT NULL CHECK (length(ip_key) = 64),
  action TEXT NOT NULL,
  window_started_at BIGINT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (ip_key, action)
);

CREATE INDEX highlevel_ip_rate_limits_updated_idx
  ON highlevel_ip_rate_limits(updated_at);

CREATE TABLE relay_adoption (
  installation_id TEXT PRIMARY KEY REFERENCES installations(id) ON DELETE CASCADE,
  app_version TEXT NOT NULL CHECK (length(app_version) BETWEEN 1 AND 32),
  e2e_devices INTEGER NOT NULL CHECK (e2e_devices BETWEEN 0 AND 100),
  legacy_devices INTEGER NOT NULL CHECK (legacy_devices BETWEEN 0 AND 100),
  continent TEXT CHECK (continent IS NULL OR length(continent) = 2),
  updated_at BIGINT NOT NULL
);

CREATE INDEX relay_adoption_updated_idx ON relay_adoption(updated_at);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]*$' AND length(id) BETWEEN 2 AND 31),
  owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (length(plan) BETWEEN 1 AND 64),
  entitlements TEXT NOT NULL DEFAULT '[]',
  allowance INTEGER CHECK (allowance IS NULL OR allowance >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'grace', 'suspended')),
  grace_ends_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX workspaces_owner_idx ON workspaces(owner_user_id, created_at);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX workspace_members_user_idx ON workspace_members(user_id, workspace_id);

CREATE TABLE workspace_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  accepted_at BIGINT,
  revoked_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX workspace_invites_workspace_idx ON workspace_invites(workspace_id, revoked_at, accepted_at);

CREATE TABLE workspace_provider_policies (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL CHECK (provider_id IN ('claude', 'codex', 'grok', 'kimi', 'muse')),
  mode TEXT NOT NULL CHECK (mode IN ('byo', 'bundled', 'off')),
  models TEXT NOT NULL DEFAULT '[]',
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (workspace_id, provider_id)
);

CREATE TABLE operator_provider_policies (
  provider_id TEXT PRIMARY KEY CHECK (provider_id IN ('claude', 'codex', 'grok', 'kimi', 'muse')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 300),
  updated_at BIGINT NOT NULL
);

CREATE TABLE workspace_oidc_configs (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL CHECK (length(issuer) BETWEEN 8 AND 512),
  client_id TEXT NOT NULL CHECK (length(client_id) BETWEEN 1 AND 256),
  scope_mapping TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at BIGINT NOT NULL
);

CREATE TABLE workspace_audit_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 320),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  detail TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);

CREATE INDEX workspace_audit_log_workspace_idx ON workspace_audit_log(workspace_id, created_at);

CREATE TABLE workspace_spend (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (workspace_id, period)
);

CREATE TABLE workspace_tokens (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  created_at BIGINT NOT NULL,
  last_used_at BIGINT,
  revoked_at BIGINT
);

CREATE INDEX workspace_tokens_workspace_idx ON workspace_tokens(workspace_id, revoked_at);

CREATE TABLE store_subscriptions (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('apple', 'google')),
  product_id TEXT NOT NULL CHECK (length(product_id) BETWEEN 1 AND 128),
  transaction_id TEXT NOT NULL CHECK (length(transaction_id) BETWEEN 1 AND 512),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'grace', 'expired', 'revoked')),
  expires_at BIGINT,
  updated_at BIGINT NOT NULL
);

CREATE INDEX store_subscriptions_tx_idx ON store_subscriptions(transaction_id);

CREATE TABLE plan_catalog (
  id TEXT PRIMARY KEY,
  entitlements TEXT NOT NULL,
  allowance INTEGER,
  updated_at BIGINT NOT NULL
);
