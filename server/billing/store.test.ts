import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { KNOWN_ENTITLEMENTS } from "../enterprise.ts";
import { DUNNING_GRACE_MS } from "./dunning.ts";
import type { BillingEvent } from "./events.ts";
import type { BundledPlan } from "./plans.ts";
import { BillingStore } from "./store.ts";

const NOW = Date.parse("2026-11-07T12:00:00.000Z");

const event = (overrides: Partial<BillingEvent> = {}): BillingEvent => ({
  event_id: "evt_1",
  type: "billing.checkout_completed",
  created_at: new Date(NOW).toISOString(),
  provider: "stripe",
  livemode: false,
  workspace_id: "acme",
  customer_id: "cus_1",
  plan: "maximus-pro",
  entitlements: ["gateway", "unshipped-future"],
  allowance: 20000,
  ...overrides,
});

const plans = new Map<string, BundledPlan>([
  ["maximus-pro", { id: "maximus-pro", baseUsd: 49, allowanceUsd: 200, hardCapUsd: 500, entitlements: ["gateway"] }],
]);

const storeIn = (dir?: string): { store: BillingStore; dataDir: string } => {
  const dataDir = dir ?? mkdtempSync(join(tmpdir(), "billing-store-"));
  let now = NOW;
  const store = new BillingStore({ dataDir, plans, knownEntitlements: KNOWN_ENTITLEMENTS, now: () => now });
  return { store, dataDir };
};

describe("billing store", () => {
  it("grants instantly and withholds unknown entitlement ids", () => {
    const { store } = storeIn();
    const { outcome, record } = store.apply(event());
    expect(outcome).toBe("applied");
    expect(record.status).toBe("active");
    expect(store.granted("acme")).toEqual(["gateway"]);
    expect(store.record("acme")?.carried).toContain("unshipped-future");
  });

  it("acknowledges duplicate deliveries without re-applying", () => {
    const { store } = storeIn();
    expect(store.apply(event()).outcome).toBe("applied");
    const replay = store.apply(event());
    expect(replay.outcome).toBe("duplicate");
    expect(replay.record.status).toBe("active");
    // Same event id on the other provider is a different delivery.
    expect(store.apply(event({ provider: "paystack" })).outcome).toBe("applied");
  });

  it("revokes through cancel then grace expiry, and recovers", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "billing-store-"));
    let now = NOW;
    const store = new BillingStore({ dataDir, plans, knownEntitlements: KNOWN_ENTITLEMENTS, now: () => now });
    store.apply(event());
    store.apply(event({ event_id: "evt_2", type: "billing.subscription_cancelled" }));
    expect(store.record("acme")?.status).toBe("grace");
    expect(store.granted("acme")).toEqual(["gateway"]);
    now = NOW + DUNNING_GRACE_MS + 1000;
    expect(store.record("acme")?.status).toBe("suspended");
    expect(store.granted("acme")).toEqual([]);
    store.apply(event({ event_id: "evt_3", type: "billing.payment_recovered" }));
    expect(store.record("acme")?.status).toBe("active");
    expect(store.granted("acme")).toEqual(["gateway"]);
  });

  it("persists across restarts as a 0600 file and survives corruption closed", () => {
    const { dataDir } = storeIn();
    const first = new BillingStore({ dataDir, plans, knownEntitlements: KNOWN_ENTITLEMENTS, now: () => NOW });
    first.apply(event());
    const file = join(dataDir, "billing", "store.json");
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const second = new BillingStore({ dataDir, plans, knownEntitlements: KNOWN_ENTITLEMENTS, now: () => NOW });
    expect(second.granted("acme")).toEqual(["gateway"]);
    expect(second.apply(event()).outcome).toBe("duplicate");
    // Corruption fails closed to empty: nothing granted blindly, webhooks re-apply cleanly.
    writeFileSync(file, "{not json");
    const third = new BillingStore({ dataDir, plans, knownEntitlements: KNOWN_ENTITLEMENTS, now: () => NOW });
    expect(third.granted("acme")).toEqual([]);
    expect(third.apply(event()).outcome).toBe("applied");
    expect(readFileSync(file, "utf8")).toContain("acme");
  });
});
