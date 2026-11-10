-- Track 3: workspace tokens (contracts section 7). A portal-managed
-- workspace server authenticates read-only sync calls (entitlements,
-- providers, spend) with its token; only the sha256 is stored. Forward-only.
CREATE TABLE workspace_tokens (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX workspace_tokens_workspace_idx ON workspace_tokens(workspace_id, revoked_at);
