-- Track 3: multi-tenant workspaces, invites, provider policies, OIDC SSO
-- configs, audit log and spend ledger. Forward-only: this migration only
-- creates new tables and indexes; earlier Workers keep working without them
-- (every new route answers 503 unavailable when a table is missing).
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY CHECK (id GLOB '[a-z][a-z0-9-]*' AND length(id) BETWEEN 2 AND 31),
  owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (length(plan) BETWEEN 1 AND 64),
  entitlements TEXT NOT NULL DEFAULT '[]',
  allowance INTEGER CHECK (allowance IS NULL OR allowance >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'grace', 'suspended')),
  grace_ends_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX workspaces_owner_idx ON workspaces(owner_user_id, created_at);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_at INTEGER NOT NULL,
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
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX workspace_invites_workspace_idx ON workspace_invites(workspace_id, revoked_at, accepted_at);

CREATE TABLE workspace_provider_policies (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL CHECK (provider_id IN ('claude', 'codex', 'grok', 'kimi', 'muse')),
  mode TEXT NOT NULL CHECK (mode IN ('byo', 'bundled', 'off')),
  models TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, provider_id)
);

CREATE TABLE operator_provider_policies (
  provider_id TEXT PRIMARY KEY CHECK (provider_id IN ('claude', 'codex', 'grok', 'kimi', 'muse')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 300),
  updated_at INTEGER NOT NULL
);

CREATE TABLE workspace_oidc_configs (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL CHECK (length(issuer) BETWEEN 8 AND 512),
  client_id TEXT NOT NULL CHECK (length(client_id) BETWEEN 1 AND 256),
  scope_mapping TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL
);

CREATE TABLE workspace_audit_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 320),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  detail TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX workspace_audit_log_workspace_idx ON workspace_audit_log(workspace_id, created_at);

CREATE TABLE workspace_spend (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, period)
);
