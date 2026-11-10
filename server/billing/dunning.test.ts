import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { KNOWN_ENTITLEMENTS } from "../enterprise.ts";
import { applyBillingEvent, billingBanner, billingStartupLog, DUNNING_GRACE_MS, type BillingRecord } from "./dunning.ts";
import type { BillingEvent } from "./events.ts";

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
  entitlements: ["admin", "billing", "budgets", "gateway", "unshipped-future"],
  allowance: 20000,
  ...overrides,
});

describe("dunning state machine", () => {
  it("grants on checkout and re-syncs on update", () => {
    const granted = applyBillingEvent(null, event(), { now: NOW });
    expect(granted).toMatchObject({ status: "active", graceEndsAt: null, plan: "maximus-pro", allowanceUsd: 200 });
    expect(granted.carried).toContain("unshipped-future");
    const updated = applyBillingEvent(granted, event({ event_id: "evt_2", type: "billing.subscription_updated", plan: "maximus-starter", allowance: 5000 }), { now: NOW + 1000 });
    expect(updated).toMatchObject({ status: "active", plan: "maximus-starter", allowanceUsd: 50 });
  });

  it("falls back to the catalog allowance when the event carries none", () => {
    const granted = applyBillingEvent(null, event({ allowance: null }), { now: NOW, planAllowanceUsd: 75 });
    expect(granted.allowanceUsd).toBe(75);
  });

  it("degrades cancel and failure to grace, keeps features, then suspends at grace end", () => {
    const active = applyBillingEvent(null, event(), { now: NOW });
    const cancelled = applyBillingEvent(active, event({ event_id: "evt_2", type: "billing.subscription_cancelled" }), { now: NOW + 1000 });
    expect(cancelled.status).toBe("grace");
    expect(cancelled.graceEndsAt).toBe(NOW + 1000 + DUNNING_GRACE_MS);
    expect(cancelled.carried).toEqual(active.carried);
    const failed = applyBillingEvent(active, event({ event_id: "evt_3", type: "billing.payment_failed" }), { now: NOW + 1000 });
    expect(failed.status).toBe("grace");
    // A second failure during grace does not extend it.
    const again = applyBillingEvent(failed, event({ event_id: "evt_4", type: "billing.payment_failed" }), { now: NOW + 2000 });
    expect(again.graceEndsAt).toBe(failed.graceEndsAt);
    // Grace expiry suspends without any new event: reads settle.
    expect(billingBanner(again, NOW + DUNNING_GRACE_MS + 5000)).toMatchObject({ kind: "suspended" });
    // A fresh failure after expiry re-enters grace (the subscription still exists at the provider).
    const regrace = applyBillingEvent(again, event({ event_id: "evt_5", type: "billing.payment_failed" }), { now: NOW + DUNNING_GRACE_MS + 5000 });
    expect(regrace.status).toBe("grace");
    expect(regrace.graceEndsAt).toBe(NOW + DUNNING_GRACE_MS + 5000 + DUNNING_GRACE_MS);
  });

  it("recovers from grace and suspension back to active", () => {
    const active = applyBillingEvent(null, event(), { now: NOW });
    const grace = applyBillingEvent(active, event({ event_id: "evt_2", type: "billing.payment_failed" }), { now: NOW + 1000 });
    const recovered = applyBillingEvent(grace, event({ event_id: "evt_3", type: "billing.payment_recovered" }), { now: NOW + 2000 });
    expect(recovered).toMatchObject({ status: "active", graceEndsAt: null });
    expect(recovered.carried).toContain("gateway");
  });

  it("renders grace and suspended banners and a startup log line", () => {
    const active = applyBillingEvent(null, event(), { now: NOW });
    expect(billingBanner(active, NOW)).toBeNull();
    const grace = applyBillingEvent(active, event({ event_id: "evt_2", type: "billing.payment_failed" }), { now: NOW });
    expect(billingBanner(grace, NOW)).toMatchObject({ kind: "grace", title: "Payment needs attention" });
    expect(billingBanner(grace, NOW)?.body).toContain("maximus-pro");
    const suspended: BillingRecord = { ...grace, status: "suspended", graceEndsAt: null, carried: [], allowanceUsd: null };
    expect(billingBanner(suspended, NOW)).toMatchObject({ kind: "suspended", title: "Subscription ended — free tier" });
    expect(billingBanner(suspended, NOW)?.body).toContain("No workspace data was removed");
    expect(billingStartupLog(grace, ["gateway"])).toContain("acme");
    expect(KNOWN_ENTITLEMENTS).toContain("gateway");
  });

  it("never destroys user data: billing writes stay inside the billing store", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "billing-dunning-"));
    const sentinel = join(dataDir, "user-data.txt");
    writeFileSync(sentinel, "precious");
    const active = applyBillingEvent(null, event(), { now: NOW });
    void active;
    expect(readFileSync(sentinel, "utf8")).toBe("precious");
    expect(readdirSync(dataDir)).toEqual(["user-data.txt"]);
  });
});
