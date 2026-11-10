// Bundled plan catalog: base subscription + monthly allowance + optional hard
// cap, per workspace. The catalog is operator configuration
// (`MAXIMUS_BILLING_PLANS` JSON), never code: commercial prices are not ours
// to invent. Amounts are USD; webhook allowances arrive in minor units and
// are converted here so overage always reconciles against the USD ledger.
import { z } from "zod";

export const planSchema = z.object({
  id: z.string().min(1).max(120),
  /** Base subscription price per workspace per month, USD. */
  baseUsd: z.number().finite().min(0),
  /** Monthly model-spend allowance included in the base, USD. */
  allowanceUsd: z.number().finite().min(0),
  /** Hard monthly ceiling: past it turns refuse with spend_cap 409. Null means overage is unbounded. */
  hardCapUsd: z.number().finite().min(0).nullable(),
  /** Entitlement ids the plan grants (contracts section 2; unknown ids carried, never granted). */
  entitlements: z.array(z.string().min(1).max(80)).max(64),
});
export type BundledPlan = z.infer<typeof planSchema>;

export const BILLING_PLANS_ENV = "MAXIMUS_BILLING_PLANS";

export function parsePlanCatalog(raw: unknown): Map<string, BundledPlan> {
  const catalog = new Map<string, BundledPlan>();
  const shape = z.object({ plans: z.array(z.unknown()).max(64) }).safeParse(raw);
  if (!shape.success) return catalog;
  for (const candidate of shape.data.plans) {
    // One bad plan never sinks the catalog: it is dropped, the rest stand.
    const parsed = planSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const plan = parsed.data;
    if (plan.hardCapUsd !== null && plan.hardCapUsd < plan.allowanceUsd) continue;
    catalog.set(plan.id, plan);
  }
  return catalog;
}

export function planCatalogFromEnv(env: NodeJS.ProcessEnv = process.env): Map<string, BundledPlan> {
  const raw = env[BILLING_PLANS_ENV];
  if (!raw || !raw.trim()) return new Map();
  try {
    return parsePlanCatalog(JSON.parse(raw) as unknown);
  } catch {
    return new Map();
  }
}

/** Minor units per major unit for webhook currencies; unknown currencies fail closed (no conversion guessed). */
const MINOR_PER_MAJOR: Readonly<Record<string, number>> = {
  USD: 100, EUR: 100, GBP: 100, NGN: 100, GHS: 100, KES: 100, ZAR: 100, CAD: 100, AUD: 100,
  JPY: 1, KRW: 1,
};

export function minorToUsd(minor: number, currency: string): number | null {
  const per = MINOR_PER_MAJOR[currency.toUpperCase()];
  if (!per || !Number.isInteger(minor) || minor < 0) return null;
  return minor / per;
}
