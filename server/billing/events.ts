// Billing webhook events, normalized from Stripe + Paystack into the frozen
// schema from contracts section 5. Both payment providers collapse to this
// one shape before anything is applied, so grant/revoke/replay logic never
// branches on provider quirks.
import { z } from "zod";

export const BILLING_EVENT_TYPES = [
  "billing.checkout_completed",
  "billing.subscription_updated",
  "billing.subscription_cancelled",
  "billing.payment_failed",
  "billing.payment_recovered",
] as const;
export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number];

export const BILLING_PROVIDERS = ["stripe", "paystack", "bachs"] as const;
export type BillingProvider = (typeof BILLING_PROVIDERS)[number];

const isoDateTime = z.string().refine((value) => Number.isFinite(Date.parse(value)), { message: "created_at must be ISO-8601" });

export const billingEventSchema = z.object({
  event_id: z.string().min(1).max(256),
  type: z.enum(BILLING_EVENT_TYPES),
  created_at: isoDateTime,
  provider: z.enum(BILLING_PROVIDERS),
  livemode: z.boolean(),
  workspace_id: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/),
  customer_id: z.string().min(1).max(256),
  plan: z.string().min(1).max(120),
  entitlements: z.array(z.string().min(1).max(80)).max(64),
  /** Monthly model-spend allowance in minor currency units, or null when the plan carries none. */
  allowance: z.number().int().min(0).nullable(),
});
export type BillingEvent = z.infer<typeof billingEventSchema>;

export function parseBillingEvent(value: unknown): BillingEvent | null {
  const parsed = billingEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Duplicate deliveries of one provider event collapse onto this key and are acknowledged without re-applying. */
export function idempotencyKey(event: Pick<BillingEvent, "provider" | "event_id">): string {
  return `${event.provider}:${event.event_id}`;
}

/** Unknown entitlement ids ride along on the record and are never granted (contracts section 2 invariant). */
export function grantedFromCarried(carried: readonly string[], known: readonly string[]): string[] {
  return [...new Set(carried.filter((id) => known.includes(id)))].sort();
}
