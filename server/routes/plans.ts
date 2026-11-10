// Admin plan catalog: GET /api/admin/plans, POST /api/admin/plans,
// PUT /api/admin/plans/{id}. Owner/admin only. Saved plans persist in the
// data dir, override the MAXIMUS_BILLING_PLANS seed by id, and show on the
// pricing page immediately. Free is synthetic: listed, never stored or edited.
import { ownerOrAdmin } from "../request-auth.ts";
import type { BundledPlan } from "../billing/plans.ts";
import { storedPlanSchema, type EffectiveCatalog, type StoredPlan } from "../billing/plan-store.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PlanRouteDeps {
  knownEntitlements: readonly string[];
  catalog: () => EffectiveCatalog;
  upsert: (plan: StoredPlan) => void;
}

export interface AdminPlanView extends BundledPlan {
  name: string;
  blurb: string;
  features: string[];
  source: "stored" | "env" | "builtin";
  editable: boolean;
}

const BODY_LIMIT = 32_768;

function views(catalog: EffectiveCatalog): AdminPlanView[] {
  const pricing = catalog.plans.get("free");
  const free = catalog.displays.get("free");
  const rows: AdminPlanView[] = [{
    id: "free",
    name: free?.name ?? "Free",
    blurb: free?.blurb ?? "",
    features: free ? [...free.features] : [],
    baseUsd: pricing?.baseUsd ?? 0,
    allowanceUsd: pricing?.allowanceUsd ?? 0,
    hardCapUsd: pricing?.hardCapUsd ?? null,
    entitlements: pricing ? [...pricing.entitlements] : [],
    source: free || pricing ? "stored" : "builtin",
    editable: true,
  }];
  for (const [id, plan] of catalog.plans) {
    if (id === "free") continue;
    const display = catalog.displays.get(id);
    rows.push({
      ...plan,
      name: display?.name ?? id,
      blurb: display?.blurb ?? "",
      features: display ? [...display.features] : [],
      source: display ? "stored" : "env",
      editable: true,
    });
  }
  return rows;
}

function problems(body: unknown, knownEntitlements: readonly string[]): { plan?: StoredPlan; error?: string } {
  const parsed = storedPlanSchema.safeParse(body);
  if (!parsed.success) return { error: "plan needs an id, name, baseUsd, allowanceUsd, entitlements, and display" };
  const plan = parsed.data;
  if (plan.hardCapUsd !== null && plan.hardCapUsd < plan.allowanceUsd) {
    return { error: "hardCapUsd must be null or at least the allowance" };
  }
  const unknown = plan.entitlements.filter((id) => !knownEntitlements.includes(id));
  if (unknown.length > 0) return { error: `unknown entitlement: ${unknown[0]}` };
  return { plan };
}

export function createPlanRoutes(deps: PlanRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const item = /^\/api\/admin\/plans\/([a-z][a-z0-9-]{1,30})$/.exec(path);
    if (!((method === "GET" || method === "POST") && path === "/api/admin/plans") && !(method === "PUT" && item)) {
      return PASS;
    }
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only an admin can manage plans." });
    res.setHeader("cache-control", "no-store");
    if (method === "GET") {
      json(res, 200, { plans: views(deps.catalog()) });
      return;
    }
    let body: unknown = null;
    try {
      body = await readBody(req, BODY_LIMIT);
    } catch {
      return json(res, 400, { error: "unreadable plan body" });
    }
    if (method === "POST") {
      const { plan, error } = problems(body, deps.knownEntitlements);
      if (!plan) return json(res, 400, { error });
      if (deps.catalog().plans.has(plan.id)) return json(res, 409, { error: `plan "${plan.id}" already exists` });
      deps.upsert(plan);
      json(res, 201, { plan: views(deps.catalog()).find((row) => row.id === plan.id) });
      return;
    }
    const id = item![1]!;
    if (id !== "free" && !deps.catalog().plans.has(id)) return json(res, 404, { error: `no such plan "${id}"` });
    const shaped = { ...(typeof body === "object" && body !== null ? body : {}), id };
    const { plan, error } = problems(shaped, deps.knownEntitlements);
    if (!plan) return json(res, 400, { error });
    deps.upsert(plan);
    json(res, 200, { plan: views(deps.catalog()).find((row) => row.id === id) });
  };
}
