-- Admin ration overrides. Absent rows keep PLAN_CATALOG.
CREATE TABLE plan_catalog (
  id TEXT PRIMARY KEY,
  entitlements TEXT NOT NULL,
  allowance INTEGER,
  updated_at INTEGER NOT NULL
);
