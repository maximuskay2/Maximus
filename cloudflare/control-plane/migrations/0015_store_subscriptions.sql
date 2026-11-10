-- Phase 8: App Store / Play subscriptions. One active row per
-- workspace (the no-double-subscribe rule); transaction_id is Apple's
-- originalTransactionId or Google's purchase token (server-side only,
-- never returned to clients). Forward-only.
CREATE TABLE store_subscriptions (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('apple', 'google')),
  product_id TEXT NOT NULL CHECK (length(product_id) BETWEEN 1 AND 128),
  transaction_id TEXT NOT NULL CHECK (length(transaction_id) BETWEEN 1 AND 512),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'grace', 'expired', 'revoked')),
  expires_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX store_subscriptions_tx_idx ON store_subscriptions(transaction_id);
