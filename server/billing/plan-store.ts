// Admin-managed plan catalog: the operator env seed (`MAXIMUS_BILLING_PLANS`)
// stands until an admin saves through /api/admin/plans; saved plans persist
// in the data dir and override the seed by id. Free stays synthetic and is
// never stored or edited.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import { planSchema, type BundledPlan } from "./plans.ts";

export const PLAN_STORE_VERSION = 1;

export const planDisplaySchema = z.object({
  name: z.string().trim().min(1).max(80),
  blurb: z.string().trim().max(280),
  features: z.array(z.string().trim().min(1).max(200)).max(24),
});
export type PlanDisplay = z.infer<typeof planDisplaySchema>;

export const storedPlanSchema = planSchema.extend({
  display: planDisplaySchema,
});
export type StoredPlan = z.infer<typeof storedPlanSchema>;

const storeSchema = z.object({
  version: z.literal(PLAN_STORE_VERSION),
  plans: z.array(z.unknown()).max(64),
});

export interface PlanDisplayView {
  name: string;
  blurb: string;
  features: string[];
}

function validPlanId(id: string): boolean {
  return /^[a-z][a-z0-9-]{1,30}$/.test(id);
}

/** One bad stored plan never sinks the file: it is dropped, the rest stand. Free
 * is a normal row: editing it redefines the tier everything degrades to. */
export function parseStoredPlans(raw: unknown): StoredPlan[] {
  const shape = storeSchema.safeParse(raw);
  if (!shape.success) return [];
  const plans: StoredPlan[] = [];
  for (const candidate of shape.data.plans) {
    const parsed = storedPlanSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const plan = parsed.data;
    if (!validPlanId(plan.id)) continue;
    if (plan.hardCapUsd !== null && plan.hardCapUsd < plan.allowanceUsd) continue;
    if (!plans.some((row) => row.id === plan.id)) plans.push(plan);
  }
  return plans;
}

export class PlanStore {
  private readonly file: string;

  constructor(options: { dataDir: string }) {
    this.file = join(options.dataDir, "billing", "plans.json");
  }

  list(): StoredPlan[] {
    try {
      if (!existsSync(this.file)) return [];
      return parseStoredPlans(JSON.parse(readFileSync(this.file, "utf8")));
    } catch {
      return [];
    }
  }

  saveAll(plans: StoredPlan[]): void {
    mkdirSync(join(this.file, ".."), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, JSON.stringify({ version: PLAN_STORE_VERSION, plans }), { mode: 0o600 });
  }
}

export interface EffectiveCatalog {
  plans: Map<string, BundledPlan>;
  displays: Map<string, PlanDisplayView>;
}

/** Stored plans override the env seed by id; the seed fills every gap. */
export function resolveCatalog(envPlans: ReadonlyMap<string, BundledPlan>, stored: readonly StoredPlan[]): EffectiveCatalog {
  const plans = new Map<string, BundledPlan>(envPlans);
  const displays = new Map<string, PlanDisplayView>();
  for (const row of stored) {
    const { display, ...plan } = row;
    plans.set(row.id, plan);
    displays.set(row.id, { name: display.name, blurb: display.blurb, features: [...display.features] });
  }
  return { plans, displays };
}
