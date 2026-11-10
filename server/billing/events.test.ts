import { describe, expect, it } from "vitest";

import { grantedFromCarried, idempotencyKey, parseBillingEvent } from "./events.ts";

describe("billing events", () => {
  it("parses the frozen schema and rejects the rest", () => {
    const valid = {
      event_id: "evt_1", type: "billing.checkout_completed", created_at: "2026-11-07T12:00:00.000Z",
      provider: "stripe", livemode: false, workspace_id: "acme", customer_id: "cus_1",
      plan: "maximus-pro", entitlements: ["gateway"], allowance: 20000,
    };
    expect(parseBillingEvent(valid)).toEqual(valid);
    expect(parseBillingEvent({ ...valid, type: "billing.unknown" })).toBeNull();
    expect(parseBillingEvent({ ...valid, workspace_id: "BAD" })).toBeNull();
    expect(parseBillingEvent({ ...valid, created_at: "not-a-date" })).toBeNull();
    expect(parseBillingEvent({ ...valid, allowance: -1 })).toBeNull();
    expect(parseBillingEvent(null)).toBeNull();
  });

  it("keys idempotency by provider plus event id and grants known ids only", () => {
    expect(idempotencyKey({ provider: "stripe", event_id: "evt_1" })).toBe("stripe:evt_1");
    expect(idempotencyKey({ provider: "paystack", event_id: "evt_1" })).toBe("paystack:evt_1");
    expect(grantedFromCarried(["gateway", "future", "billing", "gateway"], ["billing", "gateway"])).toEqual(["billing", "gateway"]);
  });
});
