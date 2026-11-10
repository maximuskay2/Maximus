import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { signPaystackPayload, signStripePayload, verifyPaystackSignature, verifyStripeSignature } from "./verify.ts";

const STRIPE_SECRET = "whsec_fixture_only_not_a_real_secret";
const PAYSTACK_SECRET = "sk_test_fixture_only_not_a_real_secret";
const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const raw = (name: string): string => readFileSync(join(dir, name), "utf8");

describe("webhook signature verification", () => {
  it("accepts a fresh Stripe signature on a recorded fixture", () => {
    const body = raw("stripe.invoice.payment_failed.json");
    const now = Math.floor(Date.now() / 1000);
    const header = signStripePayload(body, STRIPE_SECRET, now - 10);
    expect(verifyStripeSignature(body, header, STRIPE_SECRET, now)).toBe(true);
  });

  it("rejects tampered, stale, and missing Stripe signatures", () => {
    const body = raw("stripe.invoice.payment_failed.json");
    const now = Math.floor(Date.now() / 1000);
    const fresh = signStripePayload(body, STRIPE_SECRET, now);
    expect(verifyStripeSignature(`${body} `, fresh, STRIPE_SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, fresh, "whsec_wrong", now)).toBe(false);
    expect(verifyStripeSignature(body, signStripePayload(body, STRIPE_SECRET, now - 301), STRIPE_SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, undefined, STRIPE_SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, fresh, "", now)).toBe(false);
    expect(verifyStripeSignature(body, "t=abc,v1=zzz", STRIPE_SECRET, now)).toBe(false);
  });

  it("accepts any matching Stripe v1 entry and ignores v0 entries", () => {
    const body = raw("stripe.invoice.payment_failed.json");
    const now = Math.floor(Date.now() / 1000);
    const valid = signStripePayload(body, STRIPE_SECRET, now);
    const v1 = valid.split(",").find((part) => part.startsWith("v1="));
    expect(verifyStripeSignature(body, `t=${now},v0=deadbeef,${v1}`, STRIPE_SECRET, now)).toBe(true);
  });

  it("accepts a Paystack signature on a recorded fixture and rejects forgeries", () => {
    const body = raw("paystack.invoice.payment_failed.json");
    const signature = signPaystackPayload(body, PAYSTACK_SECRET);
    expect(verifyPaystackSignature(body, signature, PAYSTACK_SECRET)).toBe(true);
    expect(verifyPaystackSignature(`${body}\n`, signature, PAYSTACK_SECRET)).toBe(false);
    expect(verifyPaystackSignature(body, signature, "sk_test_wrong")).toBe(false);
    expect(verifyPaystackSignature(body, undefined, PAYSTACK_SECRET)).toBe(false);
    expect(verifyPaystackSignature(body, "not-hex", PAYSTACK_SECRET)).toBe(false);
  });
});
