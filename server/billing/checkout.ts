// Provider-agnostic checkout: one request shape fans out to Stripe Checkout
// Sessions or Paystack transaction initialize. Secrets arrive as arguments
// (harness-side env, never the repo, never the client) and never appear in
// URLs, errors or logs; `fetchImpl` is injected so tests run on fixtures.
import { z } from "zod";

import type { BillingProvider } from "./events.ts";

export interface CheckoutRequest {
  provider: BillingProvider;
  /** Operator's catalog id (plans.ts); the provider-side price ref is resolved separately. */
  plan: string;
  workspaceId: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  entitlements: string[];
  /** Monthly allowance in minor units, echoed back on webhooks via provider metadata. */
  allowanceMinor: number | null;
  /** Stripe price id (`price_…`) or Paystack plan code, from operator config. */
  providerPriceRef?: string;
  /** Paystack charge in kobo when no plan code is configured. */
  amountMinor?: number;
}

export interface CheckoutSecrets {
  stripeSecretKey?: string;
  paystackSecretKey?: string;
  bachsApiKey?: string;
  bachsApiBase?: string;
}

export interface CheckoutResult {
  provider: BillingProvider;
  url: string;
  sessionId: string;
  livemode: boolean;
}

export interface CheckoutDeps {
  fetchImpl?: typeof fetch;
  secrets?: CheckoutSecrets;
}

const stripeSessionSchema = z.object({ id: z.string(), url: z.string().nullable(), livemode: z.boolean() });
const paystackInitSchema = z.object({
  status: z.boolean(),
  message: z.string().optional(),
  data: z.object({ authorization_url: z.string(), reference: z.string() }).optional(),
});

const absoluteHttp = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const WORKSPACE = /^[a-z][a-z0-9-]{1,30}$/;

function validateRequest(request: CheckoutRequest): string | null {
  if (!WORKSPACE.test(request.workspaceId)) return "workspaceId is invalid";
  const amount = request.amountMinor;
  const priced = Boolean(request.providerPriceRef)
    || (request.provider === "paystack" && typeof amount === "number" && Number.isInteger(amount) && amount > 0)
    || (request.provider === "bachs" && typeof amount === "number" && Number.isInteger(amount) && amount > 0);
  if (!request.plan || !priced) return "plan and providerPriceRef are required";
  if (!absoluteHttp(request.successUrl) || !absoluteHttp(request.cancelUrl)) return "successUrl and cancelUrl must be absolute URLs";
  if (request.entitlements.some((id) => !id)) return "entitlements must be non-empty ids";
  if (request.allowanceMinor !== null && (!Number.isInteger(request.allowanceMinor) || request.allowanceMinor < 0)) {
    return "allowanceMinor must be a non-negative integer or null";
  }
  return null;
}

/** Operator maps catalog plans to provider-side price refs: `{"pro":"price_…"}`, never in code. */
export function providerPriceRefFromEnv(env: NodeJS.ProcessEnv, provider: BillingProvider, plan: string): string | null {
  const raw = provider === "stripe"
    ? env.MAXIMUS_STRIPE_PRICES
    : provider === "bachs"
      ? env.MAXIMUS_BACHS_PRODUCTS
      : env.MAXIMUS_PAYSTACK_PLANS;
  if (!raw) return null;
  try {
    const map: unknown = JSON.parse(raw);
    const ref = typeof map === "object" && map !== null ? (map as Record<string, unknown>)[plan] : null;
    return typeof ref === "string" && ref ? ref : null;
  } catch {
    return null;
  }
}

export function checkoutSecretsFromEnv(env: NodeJS.ProcessEnv = process.env): CheckoutSecrets {
  return {
    ...(env.STRIPE_SECRET_KEY ? { stripeSecretKey: env.STRIPE_SECRET_KEY } : {}),
    ...(env.PAYSTACK_SECRET_KEY ? { paystackSecretKey: env.PAYSTACK_SECRET_KEY } : {}),
    ...(env.BACHS_API_KEY ? { bachsApiKey: env.BACHS_API_KEY } : {}),
    ...(env.BACHS_API_BASE ? { bachsApiBase: env.BACHS_API_BASE } : {}),
  };
}

async function createStripeCheckout(request: CheckoutRequest, secret: string, fetchImpl: typeof fetch): Promise<CheckoutResult> {
  if (!request.providerPriceRef) throw new Error("checkout failed: plan and providerPriceRef are required");
  const form = new URLSearchParams({
    mode: "subscription",
    success_url: request.successUrl,
    cancel_url: request.cancelUrl,
    client_reference_id: request.workspaceId,
    "line_items[0][price]": request.providerPriceRef,
    "line_items[0][quantity]": "1",
    "subscription_data[metadata][workspace_id]": request.workspaceId,
    "subscription_data[metadata][plan]": request.plan,
    "subscription_data[metadata][entitlements]": JSON.stringify(request.entitlements),
    ...(request.allowanceMinor !== null ? { "subscription_data[metadata][allowance]": String(request.allowanceMinor) } : {}),
    ...(request.customerEmail ? { customer_email: request.customerEmail } : {}),
  });
  const response = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof (body as { error?: { message?: unknown } } | null)?.error?.message === "string"
      ? (body as { error: { message: string } }).error.message
      : `stripe answered ${response.status}`;
    throw new Error(`checkout failed: ${message.slice(0, 200)}`);
  }
  const session = stripeSessionSchema.safeParse(body);
  if (!session.success || !session.data.url) throw new Error("checkout failed: stripe answered without a session URL");
  return { provider: "stripe", url: session.data.url, sessionId: session.data.id, livemode: session.data.livemode };
}

async function createPaystackCheckout(request: CheckoutRequest, secret: string, fetchImpl: typeof fetch): Promise<CheckoutResult> {
  if (!request.customerEmail) throw new Error("checkout failed: paystack requires a customer email");
  const response = await fetchImpl("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({
      email: request.customerEmail,
      ...(request.providerPriceRef ? { plan: request.providerPriceRef } : { amount: request.amountMinor }),
      callback_url: request.successUrl,
      metadata: {
        workspace_id: request.workspaceId,
        plan: request.plan,
        entitlements: JSON.stringify(request.entitlements),
        cancel_action: request.cancelUrl,
        ...(request.allowanceMinor !== null ? { allowance: String(request.allowanceMinor) } : {}),
      },
    }),
  });
  const body: unknown = await response.json().catch(() => null);
  const parsed = paystackInitSchema.safeParse(body);
  if (!response.ok || !parsed.success || !parsed.data.status || !parsed.data.data) {
    const message = parsed.success && typeof parsed.data.message === "string" ? parsed.data.message : `paystack answered ${response.status}`;
    throw new Error(`checkout failed: ${message.slice(0, 200)}`);
  }
  return {
    provider: "paystack",
    url: parsed.data.data.authorization_url,
    sessionId: parsed.data.data.reference,
    livemode: !secret.startsWith("sk_test_"),
  };
}

const bachsSessionSchema = z.object({
  checkout_id: z.string(),
  checkout_url: z.string(),
});

async function createBachsCheckout(request: CheckoutRequest, secret: string, apiBase: string, fetchImpl: typeof fetch): Promise<CheckoutResult> {
  const metadata = {
    workspace_id: request.workspaceId,
    plan: request.plan,
    entitlements: JSON.stringify(request.entitlements),
    ...(request.allowanceMinor !== null ? { allowance: String(request.allowanceMinor) } : {}),
  };
  const body = request.providerPriceRef
    ? {
        product_cart: [{ product_id: request.providerPriceRef, quantity: 1 }],
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        metadata,
        ...(request.customerEmail ? { customer: { email: request.customerEmail } } : {}),
      }
    : {
        pricing: {
          currency: "USD",
          amount: (Number(request.amountMinor) / 100).toFixed(2),
        },
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        metadata,
        ...(request.customerEmail ? { customer: { email: request.customerEmail } } : {}),
      };
  const base = apiBase.replace(/\/$/, "");
  const response = await fetchImpl(`${base}/v1/checkout-sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  const parsed = bachsSessionSchema.safeParse(payload);
  if (!response.ok || !parsed.success) {
    const message = typeof (payload as { message?: unknown } | null)?.message === "string"
      ? (payload as { message: string }).message
      : `bachs answered ${response.status}`;
    throw new Error(`checkout failed: ${message.slice(0, 200)}`);
  }
  return {
    provider: "bachs",
    url: parsed.data.checkout_url,
    sessionId: parsed.data.checkout_id,
    livemode: !secret.startsWith("sk_sandbox_"),
  };
}

export async function createCheckoutSession(request: CheckoutRequest, deps: CheckoutDeps = {}): Promise<CheckoutResult> {
  const invalid = validateRequest(request);
  if (invalid) throw new Error(`checkout failed: ${invalid}`);
  const fetchImpl = deps.fetchImpl ?? fetch;
  if (request.provider === "stripe") {
    const secret = deps.secrets?.stripeSecretKey;
    if (!secret) throw new Error("checkout failed: stripe is not configured");
    return createStripeCheckout(request, secret, fetchImpl);
  }
  if (request.provider === "bachs") {
    const secret = deps.secrets?.bachsApiKey;
    if (!secret) throw new Error("checkout failed: bachs is not configured");
    const apiBase = deps.secrets?.bachsApiBase || "https://sandbox-api.bachs.io";
    return createBachsCheckout(request, secret, apiBase, fetchImpl);
  }
  const secret = deps.secrets?.paystackSecretKey;
  if (!secret) throw new Error("checkout failed: paystack is not configured");
  return createPaystackCheckout(request, secret, fetchImpl);
}
