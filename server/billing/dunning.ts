// Dunning state machine: failed/cancelled payments degrade active -> grace ->
// suspended, and recovery returns to active. Suspended workspaces keep every
// byte of user data — billing state only ever grants or withholds features,
// and the banner tells the workspace exactly which. Pure: the store owns
// persistence, this module owns the transitions.
import type { BillingEvent } from "./events.ts";

export const DUNNING_GRACE_MS = 7 * 24 * 60 * 60_000;

export type BillingStatus = "active" | "grace" | "suspended";

export interface BillingBanner {
  kind: "grace" | "suspended";
  title: string;
  body: string;
}

export interface BillingRecord {
  workspace: string;
  plan: string;
  customerId: string;
  /** Carried ids from the payment provider (may include unshipped ids, never granted blindly). */
  carried: string[];
  /** Effective monthly allowance, USD. Event allowance wins; the plan catalog is the fallback. */
  allowanceUsd: number | null;
  status: BillingStatus;
  /** ms epoch when grace ends; null unless grace. */
  graceEndsAt: number | null;
  updatedAt: number;
}

export interface ApplyOptions {
  now?: number;
  graceMs?: number;
  /** Catalog allowance for the event's plan, used when the event carries none. */
  planAllowanceUsd?: number | null;
}

const DAY_MS = 24 * 60 * 60_000;

/** Expired grace degrades without any new event; callers run this on every read. */
export function settleBillingStatus(record: BillingRecord, now: number): BillingRecord {
  if (record.status === "grace" && record.graceEndsAt !== null && now >= record.graceEndsAt) {
    return { ...record, carried: [], allowanceUsd: null, status: "suspended", graceEndsAt: null, updatedAt: now };
  }
  return record;
}

function toGrace(record: BillingRecord, event: BillingEvent, now: number, graceMs: number): BillingRecord {
  // A cancel/failure proves a subscription exists at the provider, so it (re)enters grace even from suspended;
  // suspension only ever comes from grace expiring with no new event. Duplicate deliveries never reach here.
  return {
    ...record,
    plan: event.plan,
    customerId: event.customer_id,
    carried: [...event.entitlements],
    status: "grace",
    graceEndsAt: record.status === "grace" && record.graceEndsAt !== null ? record.graceEndsAt : now + graceMs,
    updatedAt: now,
  };
}

export function applyBillingEvent(previous: BillingRecord | null, event: BillingEvent, options: ApplyOptions = {}): BillingRecord {
  const now = options.now ?? Date.now();
  const graceMs = options.graceMs ?? DUNNING_GRACE_MS;
  const settled = previous ? settleBillingStatus(previous, now) : null;
  const allowanceUsd = event.allowance !== null ? event.allowance / 100 : options.planAllowanceUsd ?? null;
  const base: BillingRecord = settled ?? {
    workspace: event.workspace_id,
    plan: event.plan,
    customerId: event.customer_id,
    carried: [],
    allowanceUsd: null,
    status: "suspended",
    graceEndsAt: null,
    updatedAt: now,
  };
  switch (event.type) {
    case "billing.checkout_completed":
    case "billing.subscription_updated":
    case "billing.payment_recovered":
      return {
        ...base,
        workspace: event.workspace_id,
        plan: event.plan,
        customerId: event.customer_id,
        carried: [...event.entitlements],
        allowanceUsd,
        status: "active",
        graceEndsAt: null,
        updatedAt: now,
      };
    case "billing.subscription_cancelled":
    case "billing.payment_failed":
      return toGrace({ ...base, allowanceUsd: base.allowanceUsd ?? allowanceUsd }, event, now, graceMs);
  }
}

export function billingBanner(record: BillingRecord, now: number = Date.now()): BillingBanner | null {
  const settled = settleBillingStatus(record, now);
  if (settled.status === "suspended") {
    return {
      kind: "suspended",
      title: "Subscription ended — free tier",
      body: "Paid features are off for this workspace. No workspace data was removed; upgrade to restore them.",
    };
  }
  if (settled.status === "grace" && settled.graceEndsAt !== null) {
    const ends = new Date(settled.graceEndsAt).toISOString().slice(0, 10);
    const days = Math.max(0, Math.ceil((settled.graceEndsAt - now) / DAY_MS));
    return {
      kind: "grace",
      title: "Payment needs attention",
      body: `Paid features keep working for ${days} more day${days === 1 ? "" : "s"} (until ${ends}). Update payment to stay on ${settled.plan}.`,
    };
  }
  return null;
}

export function billingStartupLog(record: BillingRecord, granted: readonly string[]): string {
  const features = granted.join(", ") || "no features";
  const banner = billingBanner(record);
  if (banner) return `billing for ${record.workspace}: ${features} (${banner.title.toLowerCase()})`;
  return `billing for ${record.workspace}: ${features} (${record.plan})`;
}
