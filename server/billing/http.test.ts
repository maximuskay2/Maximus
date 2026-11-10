import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { KNOWN_ENTITLEMENTS } from "../enterprise.ts";
import { handleBillingWebhook } from "./http.ts";
import { BillingStore } from "./store.ts";
import { signPaystackPayload, signStripePayload } from "./verify.ts";

const STRIPE_SECRET = "whsec_fixture_only_not_a_real_secret";
const PAYSTACK_SECRET = "sk_test_fixture_only_not_a_real_secret";
const NOW = Date.parse("2026-11-07T12:00:00.000Z");
const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const raw = (name: string): string => readFileSync(join(dir, name), "utf8");

const stripeHeaders = (body: string): Record<string, string> => ({
  "stripe-signature": signStripePayload(body, STRIPE_SECRET, Math.floor(NOW / 1000)),
});
const paystackHeaders = (body: string): Record<string, string> => ({
  "x-paystack-signature": signPaystackPayload(body, PAYSTACK_SECRET),
});

const depsFor = () => {
  const dataDir = mkdtempSync(join(tmpdir(), "billing-http-"));
  const store = new BillingStore({ dataDir, knownEntitlements: KNOWN_ENTITLEMENTS, now: () => NOW });
  return { store, secrets: { stripeWebhookSecret: STRIPE_SECRET, paystackSecretKey: PAYSTACK_SECRET }, nowSeconds: () => Math.floor(NOW / 1000) };
};

describe("billing webhook handler", () => {
  it("grants on Stripe checkout, dedupes the replay, then revokes on cancel", () => {
    const deps = depsFor();
    const checkout = raw("stripe.checkout.session.completed.json");
    const first = handleBillingWebhook("stripe", stripeHeaders(checkout), checkout, deps);
    expect(first).toEqual({ status: 200, body: { accepted: true, duplicate: false, workspace: "acme", status: "active" } });
    expect(deps.store.granted("acme")).toEqual(["billing", "budgets", "gateway"]);
    const replay = handleBillingWebhook("stripe", stripeHeaders(checkout), checkout, deps);
    expect(replay.body).toMatchObject({ accepted: true, duplicate: true });
    const cancel = raw("stripe.customer.subscription.deleted.json");
    const cancelled = handleBillingWebhook("stripe", stripeHeaders(cancel), cancel, deps);
    expect(cancelled.body).toMatchObject({ accepted: true, status: "grace" });
    expect(deps.store.granted("acme")).toContain("gateway");
  });

  it("runs the Paystack dunning cycle: grant, fail, recover", () => {
    const deps = depsFor();
    const created = raw("paystack.subscription.create.json");
    expect(handleBillingWebhook("paystack", paystackHeaders(created), created, deps).body).toMatchObject({ status: "active" });
    const failed = raw("paystack.invoice.payment_failed.json");
    expect(handleBillingWebhook("paystack", paystackHeaders(failed), failed, deps).body).toMatchObject({ status: "grace" });
    const recovered = raw("paystack.invoice.update.json");
    expect(handleBillingWebhook("paystack", paystackHeaders(recovered), recovered, deps).body).toMatchObject({ status: "active" });
    expect(deps.store.granted("acme")).toEqual(["admin", "billing", "budgets", "gateway"]);
  });

  it("rejects bad signatures and oversized bodies, ignores unknown types loudly-mapped ones", () => {
    const deps = depsFor();
    const checkout = raw("stripe.checkout.session.completed.json");
    expect(handleBillingWebhook("stripe", {}, checkout, deps).status).toBe(401);
    expect(handleBillingWebhook("stripe", { "stripe-signature": "t=1,v1=deadbeef" }, checkout, deps).status).toBe(401);
    expect(handleBillingWebhook("stripe", stripeHeaders(checkout), "x".repeat(257 * 1024), deps).status).toBe(413);
    expect(handleBillingWebhook("stripe", stripeHeaders("{nope"), "{nope", deps).status).toBe(400);
    const unknown = raw("stripe.customer.created.json");
    expect(handleBillingWebhook("stripe", stripeHeaders(unknown), unknown, deps)).toEqual({ status: 200, body: { accepted: true, ignored: true } });
    const bare = raw("stripe.checkout.session.completed.no-metadata.json");
    expect(handleBillingWebhook("stripe", stripeHeaders(bare), bare, deps)).toEqual({
      status: 400,
      body: { error: "Webhook event is missing workspace, plan or entitlement metadata" },
    });
  });
});
