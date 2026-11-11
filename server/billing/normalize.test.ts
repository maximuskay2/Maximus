import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { normalizeBillingEvent, normalizePaystackEvent, normalizeStripeEvent } from "./normalize.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(dir, name), "utf8"));

describe("billing event normalization", () => {
  it("maps all five Stripe event types to the frozen schema", () => {
    const cases: Array<[string, string, string]> = [
      ["stripe.checkout.session.completed.json", "billing.checkout_completed", "maximus-starter"],
      ["stripe.customer.subscription.updated.json", "billing.subscription_updated", "maximus-pro"],
      ["stripe.customer.subscription.deleted.json", "billing.subscription_cancelled", "maximus-pro"],
      ["stripe.invoice.payment_failed.json", "billing.payment_failed", "maximus-pro"],
      ["stripe.invoice.payment_succeeded.json", "billing.payment_recovered", "maximus-pro"],
    ];
    for (const [file, type, plan] of cases) {
      const event = normalizeStripeEvent(fixture(file));
      expect(event, file).toMatchObject({
        type, provider: "stripe", livemode: false, workspace_id: "acme", customer_id: "cus_fixture_acme", plan,
      });
      expect(event?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    const checkout = normalizeStripeEvent(fixture("stripe.checkout.session.completed.json"));
    expect(checkout?.event_id).toBe("evt_fixture_checkout_completed");
    expect(checkout?.entitlements).toEqual(["billing", "budgets", "gateway"]);
    expect(checkout?.allowance).toBe(5000);
  });

  it("maps all five Paystack event types to the frozen schema", () => {
    const cases: Array<[string, string]> = [
      ["paystack.subscription.create.json", "billing.checkout_completed"],
      ["paystack.invoice.create.json", "billing.subscription_updated"],
      ["paystack.subscription.disable.json", "billing.subscription_cancelled"],
      ["paystack.invoice.payment_failed.json", "billing.payment_failed"],
      ["paystack.invoice.update.json", "billing.payment_recovered"],
    ];
    for (const [file, type] of cases) {
      const event = normalizePaystackEvent(fixture(file));
      expect(event, file).toMatchObject({ type, provider: "paystack", workspace_id: "acme" });
    }
    const created = normalizePaystackEvent(fixture("paystack.subscription.create.json"));
    expect(created?.customer_id).toBe("CUS_fixture_acme");
    expect(created?.entitlements).toEqual(["billing", "budgets", "gateway"]);
    expect(created?.allowance).toBe(5000);
    expect(created?.event_id).toContain("subscription.create:310001:");
  });

  it("accepts comma-separated entitlements and empty allowance metadata", () => {
    const payload = {
      id: "evt_x", type: "checkout.session.completed", created: 1795056000, livemode: true,
      data: { object: { customer: "cus_x", metadata: { workspace_id: "acme", plan: "p", entitlements: "billing, gateway" } } },
    };
    expect(normalizeStripeEvent(payload)).toMatchObject({ entitlements: ["billing", "gateway"], allowance: null, livemode: true });
  });

  it("ignores unknown event types and unmappable payloads", () => {
    expect(normalizeStripeEvent(fixture("stripe.customer.created.json"))).toBeNull();
    expect(normalizeStripeEvent(fixture("stripe.checkout.session.completed.no-metadata.json"))).toBeNull();
    expect(normalizeStripeEvent({})).toBeNull();
    expect(normalizePaystackEvent({ event: "charge.success", data: {} })).toBeNull();
    expect(normalizePaystackEvent({
      event: "charge.success",
      data: {
        id: 99,
        paid_at: "2026-11-07T10:00:00.000Z",
        status: "success",
        customer: { email: "billing@acme.example", customer_code: "CUS_x" },
        metadata: { workspace_id: "acme", plan: "plus", entitlements: "[\"billing\"]", allowance: "1900" },
      },
    })).toMatchObject({ type: "billing.checkout_completed", plan: "plus", customer_id: "CUS_x", allowance: 1900 });
    expect(normalizeBillingEvent("stripe", fixture("stripe.invoice.payment_failed.json"))?.type).toBe("billing.payment_failed");
    expect(normalizeBillingEvent("paystack", fixture("paystack.invoice.payment_failed.json"))?.type).toBe("billing.payment_failed");
  });

  it("only treats paid Paystack invoice updates as recoveries", () => {
    const pending = JSON.parse(readFileSync(join(dir, "paystack.invoice.update.json"), "utf8")) as Record<string, unknown>;
    (pending.data as Record<string, unknown>).status = "pending";
    expect(normalizePaystackEvent(pending)).toBeNull();
  });
});
