// Billing webhook HTTP entry: signature first, JSON second, normalize third,
// idempotent apply last. Pure over (headers, raw bytes) so tests replay
// recorded fixtures without a socket; index.ts mounts it BEFORE the auth
// gate because Stripe/Paystack authenticate with a signature, not a session.
import type { IncomingMessage } from "node:http";

import type { BillingEvent, BillingProvider } from "./events.ts";
import { isKnownProviderEvent, normalizeBillingEvent } from "./normalize.ts";
import type { BillingStore } from "./store.ts";
import { verifyPaystackSignature, verifyStripeSignature } from "./verify.ts";

export const MAX_BILLING_WEBHOOK_BYTES = 256 * 1024;

export function readRawBody(req: IncomingMessage, limit = MAX_BILLING_WEBHOOK_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let done = false;
    const fail = (status: number, message: string) => {
      if (done) return;
      done = true;
      reject(Object.assign(new Error(message), { status }));
    };
    req.on("data", (chunk: Buffer | string) => {
      if (done) return;
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      bytes += buffer.length;
      if (bytes > limit) {
        req.resume();
        fail(413, "Webhook body is too large");
        return;
      }
      chunks.push(buffer);
    });
    req.once("end", () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.once("error", (error) => fail(400, error instanceof Error ? error.message : "Could not read webhook body"));
  });
}

export interface BillingWebhookSecrets {
  stripeWebhookSecret?: string;
  paystackSecretKey?: string;
}

export function billingWebhookSecretsFromEnv(env: NodeJS.ProcessEnv = process.env): BillingWebhookSecrets {
  return {
    ...(env.STRIPE_WEBHOOK_SECRET ? { stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET } : {}),
    ...(env.PAYSTACK_SECRET_KEY ? { paystackSecretKey: env.PAYSTACK_SECRET_KEY } : {}),
  };
}

export interface BillingWebhookDeps {
  store: BillingStore;
  secrets: BillingWebhookSecrets;
  nowSeconds?: () => number;
  onApplied?: (event: BillingEvent) => void;
}

export interface BillingWebhookResult {
  status: number;
  body: Record<string, unknown>;
}

const header = (headers: Record<string, string | string[] | undefined>, name: string): string | undefined => {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

export function handleBillingWebhook(
  provider: BillingProvider,
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
  deps: BillingWebhookDeps,
): BillingWebhookResult {
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BILLING_WEBHOOK_BYTES) {
    return { status: 413, body: { error: "Webhook body is too large" } };
  }
  const verified = provider === "stripe"
    ? verifyStripeSignature(rawBody, header(headers, "stripe-signature"), deps.secrets.stripeWebhookSecret ?? "", deps.nowSeconds?.() ?? Math.floor(Date.now() / 1000))
    : verifyPaystackSignature(rawBody, header(headers, "x-paystack-signature"), deps.secrets.paystackSecretKey ?? "");
  if (!verified) return { status: 401, body: { error: "Invalid webhook signature" } };
  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) as unknown : {};
  } catch {
    return { status: 400, body: { error: "Invalid JSON webhook body" } };
  }
  const event = normalizeBillingEvent(provider, payload);
  if (!event) {
    // Unknown event types (and Paystack invoices that are not recoveries) are acknowledged and ignored; a known
    // type that will not normalize is our checkout metadata bug, surfaced loudly instead of acked silently.
    if (isKnownProviderEvent(provider, payload)) {
      return { status: 400, body: { error: "Webhook event is missing workspace, plan or entitlement metadata" } };
    }
    return { status: 200, body: { accepted: true, ignored: true } };
  }
  const { outcome, record } = deps.store.apply(event);
  if (outcome === "applied") deps.onApplied?.(event);
  return {
    status: 200,
    body: { accepted: true, duplicate: outcome === "duplicate", workspace: record.workspace, status: record.status },
  };
}
