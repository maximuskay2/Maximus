import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { PriceList } from "../prices.ts";
import { appendUsage, flushUsageLedger, type UsageRow } from "../usage-ledger.ts";
import { assertWithinBundledBudget, bundledBudgetState, bundledSpendOverRows, resetBundledBudgetCacheForTests } from "./allowance.ts";

const PRICES: PriceList = {
  default: { inputPerMillion: 2, outputPerMillion: 10 },
  "codex/gpt-5.4": { inputPerMillion: 2.5, outputPerMillion: 15 },
};

const row = (overrides: Partial<UsageRow> = {}): Omit<UsageRow, "at"> & { at?: string } => ({
  botId: "bot1",
  botName: "Bot",
  threadId: "thread1",
  instanceId: "codex",
  driverKind: "codex",
  model: "gpt-5.4",
  input: 1000,
  output: 500,
  costUsd: null,
  trigger: { kind: "owner" },
  ...overrides,
});

describe("bundled hybrid engine", () => {
  it("bills bundled rows at sell prices and ignores BYO and legacy rows", () => {
    const rows: UsageRow[] = [
      { ...row({ via: "bundled" }), at: new Date().toISOString() },
      { ...row({ via: "bundled", input: 2000, output: 0 }), at: new Date().toISOString() },
      { ...row({ via: "byo", input: 1_000_000 }), at: new Date().toISOString() },
      { ...row({ via: undefined, input: 1_000_000 }), at: new Date().toISOString() },
    ];
    // (1000*2.5 + 500*15 + 2000*2.5) / 1e6 = 0.0175 -> $0.02 to the cent.
    expect(bundledSpendOverRows(rows, PRICES)).toBe(0.02);
    expect(bundledSpendOverRows(rows, null)).toBe(0);
  });

  it("burns the allowance down, accrues overage past it, and refuses only at the hard cap", async () => {
    resetBundledBudgetCacheForTests();
    const dataDir = mkdtempSync(join(tmpdir(), "bundled-allowance-"));
    const now = new Date();
    await appendUsage(dataDir, row({ via: "bundled", at: now.toISOString(), input: 1_000_000, output: 0, threadId: "t1" }));
    await appendUsage(dataDir, row({ via: "byo", at: now.toISOString(), input: 10_000_000, output: 0, threadId: "t2" }));
    expect(await flushUsageLedger(dataDir)).toBeUndefined();
    // Bundled: 1M * $2.5/M = $2.50; BYO excluded.
    const state = bundledBudgetState(10, 100, dataDir, PRICES, now);
    expect(state).toMatchObject({ spentUsd: 2.5, overageUsd: 0, withinAllowance: true, capExceeded: false, percent: 25 });
    const over = bundledBudgetState(1, null, dataDir, PRICES, now);
    expect(over).toMatchObject({ overageUsd: 1.5, withinAllowance: false, capExceeded: false });
    expect(() => assertWithinBundledBudget(over)).not.toThrow();
    const capped = bundledBudgetState(1, 2.5, dataDir, PRICES, now);
    expect(capped.capExceeded).toBe(true);
    try {
      assertWithinBundledBudget(capped);
      expect.unreachable("cap-exceeded must refuse");
    } catch (error) {
      const shaped = error as Error & { status?: number; code?: string };
      expect(shaped.status).toBe(409);
      expect(shaped.code).toBe("spend_cap");
      expect(shaped.message).toContain("Settings → Usage");
    }
  });
});
