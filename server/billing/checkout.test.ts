import { describe, expect, it } from "vitest";

import { checkoutSecretsFromEnv, createCheckoutSession, providerPriceRefFromEnv, type CheckoutRequest } from "./checkout.ts";

const base: CheckoutRequest = {
  provider: "stripe",
  plan: "maximus-pro",
  workspaceId: "acme",
  customerEmail: "billing@acme.example",
  successUrl: "https://acme.example/billing/done",
  cancelUrl: "https://acme.example/billing/cancel",
  entitlements: ["billing", "budgets", "gateway"],
  allowanceMinor: 20000,
  providerPriceRef: "price_fixture",
};

describe("provider-agnostic checkout", () => {
  it("creates a Stripe checkout session with grant metadata", async () => {
    const seenUrl: { url: string; init: { headers?: Record<string, string>; body?: string } }[] = [];
    const fetchImpl = (async (url: string, init: { headers?: Record<string, string>; body?: string }): Promise<Response> => {
      seenUrl.push({ url, init });
      return new Response(JSON.stringify({ id: "cs_fixture", url: "https://checkout.stripe.com/pay/cs_fixture", livemode: false }), { status: 200 });
    }) as typeof fetch;
    const session = await createCheckoutSession(base, { fetchImpl, secrets: { stripeSecretKey: "sk_test_fixture" } });
    expect(session).toEqual({ provider: "stripe", url: "https://checkout.stripe.com/pay/cs_fixture", sessionId: "cs_fixture", livemode: false });
    expect(seenUrl[0]?.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(seenUrl[0]?.init.headers?.authorization).toBe("Bearer sk_test_fixture");
    const form = new URLSearchParams(seenUrl[0]?.init.body ?? "");
    expect(form.get("subscription_data[metadata][workspace_id]")).toBe("acme");
    expect(form.get("subscription_data[metadata][plan]")).toBe("maximus-pro");
    expect(form.get("subscription_data[metadata][allowance]")).toBe("20000");
    expect(form.get("line_items[0][price]")).toBe("price_fixture");
  });

  it("creates a Paystack transaction with grant metadata", async () => {
    const seenBody: { body?: string; headers?: Record<string, string> }[] = [];
    const fetchImpl = (async (_url: string, init: { headers?: Record<string, string>; body?: string }): Promise<Response> => {
      seenBody.push({ body: init.body, headers: init.headers });
      return new Response(JSON.stringify({ status: true, data: { authorization_url: "https://checkout.paystack.com/ref", reference: "ref_fixture" } }), { status: 200 });
    }) as typeof fetch;
    const session = await createCheckoutSession(
      { ...base, provider: "paystack", providerPriceRef: "PLN_fixture" },
      { fetchImpl, secrets: { paystackSecretKey: "sk_test_fixture" } },
    );
    expect(session).toEqual({ provider: "paystack", url: "https://checkout.paystack.com/ref", sessionId: "ref_fixture", livemode: false });
    const body = JSON.parse(seenBody[0]?.body ?? "{}") as { metadata?: Record<string, string>; plan?: string };
    expect(body.plan).toBe("PLN_fixture");
    expect(body.metadata?.workspace_id).toBe("acme");
    expect(body.metadata?.allowance).toBe("20000");
  });

  it("refuses misconfiguration without leaking secrets", async () => {
    const fetchImpl = (async (): Promise<Response> => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 })) as typeof fetch;
    await expect(createCheckoutSession(base, { fetchImpl, secrets: {} })).rejects.toThrow("stripe is not configured");
    await expect(createCheckoutSession({ ...base, provider: "paystack" }, { fetchImpl, secrets: {} })).rejects.toThrow("paystack is not configured");
    await expect(createCheckoutSession({ ...base, workspaceId: "BAD" }, { fetchImpl, secrets: { stripeSecretKey: "sk_test_x" } })).rejects.toThrow("workspaceId");
    await expect(createCheckoutSession({ ...base, provider: "paystack", customerEmail: undefined }, { fetchImpl, secrets: { paystackSecretKey: "sk_test_x" } }))
      .rejects.toThrow("requires a customer email");
    const failed = await createCheckoutSession(base, { fetchImpl, secrets: { stripeSecretKey: "sk_test_secret" } }).catch((error: Error) => error.message);
    expect(failed).toContain("bad key");
    expect(failed).not.toContain("sk_test_secret");
  });

  it("resolves price refs and secrets from env", () => {
    const env = { MAXIMUS_STRIPE_PRICES: JSON.stringify({ "maximus-pro": "price_123" }), STRIPE_SECRET_KEY: "sk_test_x" };
    expect(providerPriceRefFromEnv(env, "stripe", "maximus-pro")).toBe("price_123");
    expect(providerPriceRefFromEnv(env, "stripe", "unknown")).toBeNull();
    expect(providerPriceRefFromEnv({}, "paystack", "maximus-pro")).toBeNull();
    expect(checkoutSecretsFromEnv(env)).toEqual({ stripeSecretKey: "sk_test_x" });
  });
});
