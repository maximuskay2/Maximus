// Entitlement sync core (contracts sections 2, 5, roadmap Track 3). The plan
// catalog maps plans to entitlement ids + monthly allowance; billing events
// (Track 4 webhooks) apply through `applyBillingEvent`, which grants/revokes
// instantly and moves cancelled/failed workspaces into grace. Grace expiry
// degrades to the free tier without destroying user data. Unknown entitlement
// ids are carried, never granted.
export const KNOWN_ENTITLEMENTS: readonly string[] = ["whitelabel", "sso", "admin", "budgets", "billing", "gateway"];

/** Grace after cancel/failure before the free tier takes over (7 days). */
export const ENTITLEMENT_GRACE_MS = 7 * 24 * 60 * 60_000;

export interface PlanDef {
  entitlements: readonly string[];
  /** Monthly model-spend allowance in minor currency units, or null for none. */
  allowance: number | null;
}

/** Plan catalog. Free is the degradation floor. Allowance is minor units
 * (cents): starter `8_00` is the $8 Muse ration, not $800. Team is the phone
 * Plus seat and Business is the phone Pro seat, so they carry those rations.
 * An admin save replaces a row through `plan_catalog`. */
export const PLAN_CATALOG: Readonly<Record<string, PlanDef>> = {
  free: { entitlements: [], allowance: null },
  byo: { entitlements: ["billing"], allowance: 0 },
  starter: { entitlements: ["billing", "gateway"], allowance: 8_00 },
  plus: { entitlements: ["billing", "gateway"], allowance: 22_00 },
  pro: { entitlements: ["billing", "gateway"], allowance: 40_00 },
  team: { entitlements: ["admin", "budgets", "billing", "gateway"], allowance: 22_00 },
  business: { entitlements: ["whitelabel", "sso", "admin", "budgets", "billing", "gateway"], allowance: 40_00 },
};

export type BillingEventType =
  | "billing.checkout_completed"
  | "billing.subscription_updated"
  | "billing.subscription_cancelled"
  | "billing.payment_failed"
  | "billing.payment_recovered";

export interface BillingEvent {
  event_id: string;
  type: BillingEventType;
  created_at: string;
  provider: "stripe" | "paystack" | "apple" | "google";
  livemode: boolean;
  workspace_id: string;
  customer_id: string;
  plan: string;
  entitlements: string[];
  allowance: number | null;
}

export interface WorkspaceEntitlementState {
  workspace: string;
  plan: string;
  entitlements: string[];
  allowance: number | null;
  status: "active" | "grace" | "suspended";
  graceEndsAt: number | null;
}

export interface EntitlementView extends WorkspaceEntitlementState {
  /** Granted ids only: known ids from the carried set. */
  granted: string[];
  /** Banner the workspace UI shows, or null when everything is healthy. */
  banner: { kind: "grace" | "suspended" | "free"; title: string; body: string } | null;
}

export function grantedEntitlements(carried: readonly string[]): string[] {
  return [...new Set(carried.filter((id) => KNOWN_ENTITLEMENTS.includes(id)))].sort();
}

function planFor(name: string): PlanDef {
  return PLAN_CATALOG[name] ?? PLAN_CATALOG.free;
}

export function entitlementsForPlan(plan: string): { entitlements: string[]; allowance: number | null } {
  const def = planFor(plan);
  return { entitlements: [...def.entitlements], allowance: def.allowance };
}

/**
 * Pure transition for one normalized billing event. Returns the workspace row
 * update plus whether user-visible state changed (for audit). Idempotency is
 * the caller's: key `{provider}:{event_id}` (contracts section 5).
 */
export function transitionForBillingEvent(
  current: WorkspaceEntitlementState,
  event: BillingEvent,
  now = Date.now(),
): { plan: string; entitlements: string[]; allowance: number | null; status: "active" | "grace"; graceEndsAt: number | null; changed: boolean } {
  switch (event.type) {
    case "billing.checkout_completed":
    case "billing.subscription_updated":
    case "billing.payment_recovered": {
      const plan = event.plan in PLAN_CATALOG ? event.plan : current.plan;
      const def = planFor(plan);
      const entitlements = event.entitlements.length ? [...event.entitlements] : [...def.entitlements];
      const allowance = event.allowance ?? def.allowance;
      const changed = plan !== current.plan
        || JSON.stringify([...entitlements].sort()) !== JSON.stringify([...current.entitlements].sort())
        || allowance !== current.allowance
        || current.status !== "active";
      return { plan, entitlements, allowance, status: "active", graceEndsAt: null, changed };
    }
    case "billing.subscription_cancelled":
    case "billing.payment_failed": {
      if (current.status === "grace" && current.graceEndsAt !== null) {
        return { plan: current.plan, entitlements: current.entitlements, allowance: current.allowance, status: "grace", graceEndsAt: current.graceEndsAt, changed: false };
      }
      return {
        plan: current.plan,
        entitlements: current.entitlements,
        allowance: current.allowance,
        status: "grace",
        graceEndsAt: now + ENTITLEMENT_GRACE_MS,
        changed: true,
      };
    }
  }
}

/** Grace expiry degrades to the free tier; the plan name stays for the audit trail. */
export function degradeExpiredGrace(
  current: WorkspaceEntitlementState,
  now = Date.now(),
): { status: "grace" | "suspended"; entitlements: string[]; allowance: number | null; degraded: boolean } {
  if (current.status !== "grace" || current.graceEndsAt === null || now < current.graceEndsAt) {
    return { status: current.status === "suspended" ? "suspended" : "grace", entitlements: current.entitlements, allowance: current.allowance, degraded: false };
  }
  const free = PLAN_CATALOG.free;
  return { status: "suspended", entitlements: [...free.entitlements], allowance: free.allowance, degraded: true };
}

export function entitlementView(state: WorkspaceEntitlementState, now = Date.now()): EntitlementView {
  const granted = grantedEntitlements(state.entitlements);
  if (state.status === "suspended") {
    return {
      ...state,
      granted,
      banner: {
        kind: "suspended",
        title: "Subscription ended — free tier",
        body: "This workspace is on the free tier. Upgrade to restore paid features; no workspace data was removed.",
      },
    };
  }
  if (state.status === "grace" && state.graceEndsAt !== null) {
    const ends = new Date(state.graceEndsAt).toISOString().slice(0, 10);
    const days = Math.max(0, Math.ceil((state.graceEndsAt - now) / (24 * 60 * 60_000)));
    return {
      ...state,
      granted,
      banner: {
        kind: "grace",
        title: "Payment needs attention",
        body: `Paid features keep working for ${days} more day${days === 1 ? "" : "s"} (until ${ends}). Update payment to stay on ${state.plan}.`,
      },
    };
  }
  return { ...state, granted, banner: null };
}

/** Startup log line for a hosted workspace, mirroring editionStatus/licenseWarning shape. */
export function describeEntitlementSync(view: EntitlementView): string {
  if (view.banner) return `hosted entitlements for ${view.workspace}: ${view.granted.join(", ") || "no features"} (${view.banner.title.toLowerCase()})`;
  return `hosted entitlements for ${view.workspace}: ${view.granted.join(", ") || "no features"} (${view.plan})`;
}
