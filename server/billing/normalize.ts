// Normalizes raw Stripe / Paystack webhook payloads into the frozen
// BillingEvent (contracts section 5). Returns null for event types we do not
// act on: unknown deliveries are acknowledged and ignored, never an error.
// Workspace, plan, entitlements and allowance ride on provider `metadata`
// (set at checkout); payloads without them are rejected, not guessed.
import type { BillingEvent, BillingEventType, BillingProvider } from "./events.ts";
import { parseBillingEvent } from "./events.ts";

const WORKSPACE = /^[a-z][a-z0-9-]{1,30}$/;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

const metadataOf = (value: unknown): Record<string, string> => {
  const record = asRecord(value);
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string" && entry) out[key] = entry;
  }
  return out;
};

const entitlementsOf = (raw: string | undefined): string[] | null => {
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((id): id is string => typeof id === "string" && Boolean(id))) return parsed;
  } catch {
    // Fall through to comma-separated.
  }
  const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
  return ids.length ? ids : null;
};

const allowanceOf = (raw: string | undefined): number | null | undefined => {
  if (raw === undefined || raw === "") return null;
  return /^\d{1,12}$/.test(raw) ? Number(raw) : undefined;
};

interface MetadataGrant {
  workspace_id: string;
  plan: string;
  entitlements: string[];
  allowance: number | null;
}

function grantFromMetadata(metadata: Record<string, string>): MetadataGrant | null {
  const workspace_id = metadata.workspace_id;
  const plan = metadata.plan;
  if (!workspace_id || !WORKSPACE.test(workspace_id) || !plan) return null;
  const entitlements = entitlementsOf(metadata.entitlements);
  const allowance = allowanceOf(metadata.allowance);
  if (!entitlements || allowance === undefined) return null;
  return { workspace_id, plan, entitlements, allowance };
}

const STRIPE_TYPES: Record<string, BillingEventType> = {
  "checkout.session.completed": "billing.checkout_completed",
  "customer.subscription.updated": "billing.subscription_updated",
  "customer.subscription.deleted": "billing.subscription_cancelled",
  "invoice.payment_failed": "billing.payment_failed",
  "invoice.payment_succeeded": "billing.payment_recovered",
};

/** Stripe `event.created` is unix seconds; the frozen schema wants ISO-8601. */
export function normalizeStripeEvent(payload: unknown): BillingEvent | null {
  const root = asRecord(payload);
  const type = STRIPE_TYPES[asString(root.type) ?? ""];
  const event_id = asString(root.id);
  const created = root.created;
  if (!type || !event_id || typeof created !== "number" || !Number.isFinite(created)) return null;
  const object = asRecord(asRecord(root.data).object);
  const grant = grantFromMetadata(metadataOf(object.metadata));
  if (!grant) return null;
  const customer = object.customer;
  const customer_id = asString(customer) ?? asString(asRecord(customer).id);
  if (!customer_id) return null;
  return parseBillingEvent({
    event_id,
    type,
    created_at: new Date(created * 1000).toISOString(),
    provider: "stripe",
    livemode: root.livemode === true,
    workspace_id: grant.workspace_id,
    customer_id,
    plan: grant.plan,
    entitlements: grant.entitlements,
    allowance: grant.allowance,
  });
}

const PAYSTACK_TYPES: Record<string, BillingEventType> = {
  "subscription.create": "billing.checkout_completed",
  "invoice.create": "billing.subscription_updated",
  "subscription.disable": "billing.subscription_cancelled",
  "invoice.payment_failed": "billing.payment_failed",
  "invoice.update": "billing.payment_recovered",
};

/** Paystack sends no delivery id, so the idempotency key is `event:object-id:created-at`, stable across redeliveries. */
export function normalizePaystackEvent(payload: unknown): BillingEvent | null {
  const root = asRecord(payload);
  const type = PAYSTACK_TYPES[asString(root.event) ?? ""];
  const data = asRecord(root.data);
  const objectId = data.id;
  const createdAt = asString(data.createdAt ?? data.created_at);
  if (!type || (typeof objectId !== "number" && typeof objectId !== "string") || !createdAt || !Number.isFinite(Date.parse(createdAt))) {
    return null;
  }
  if (type === "billing.payment_recovered") {
    const status = asString(data.status);
    if (status !== "success" && status !== "paid") return null;
  }
  const grant = grantFromMetadata(metadataOf(data.metadata));
  if (!grant) return null;
  const customer = asRecord(data.customer);
  const customer_id = asString(customer.customer_code) ?? asString(customer.email);
  if (!customer_id) return null;
  return parseBillingEvent({
    event_id: `${root.event}:${objectId}:${createdAt}`,
    type,
    created_at: new Date(createdAt).toISOString(),
    provider: "paystack",
    livemode: typeof root.livemode === "boolean" ? root.livemode : typeof data.livemode === "boolean" ? data.livemode : true,
    workspace_id: grant.workspace_id,
    customer_id,
    plan: grant.plan,
    entitlements: grant.entitlements,
    allowance: grant.allowance,
  });
}

export function normalizeBillingEvent(provider: BillingProvider, payload: unknown): BillingEvent | null {
  return provider === "stripe" ? normalizeStripeEvent(payload) : normalizePaystackEvent(payload);
}

/** True for event types we act on, even when this delivery lacks the metadata to apply. */
export function isKnownProviderEvent(provider: BillingProvider, payload: unknown): boolean {
  const root = asRecord(payload);
  if (provider === "stripe") return (asString(root.type) ?? "") in STRIPE_TYPES;
  return (asString(root.event) ?? "") in PAYSTACK_TYPES;
}
