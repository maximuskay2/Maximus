import { z } from "zod";

import { KNOWN_ENTITLEMENTS, PLAN_CATALOG, type PlanDef } from "./entitlements";
import { contractJSON } from "./contract";
import { HTTPError, readBoundedJSON } from "./http";

const PLAN_IDS = ["free", "byo", "starter", "plus", "pro", "team", "business"] as const;

const catalogRow = z.strictObject({
  id: z.enum(PLAN_IDS),
  entitlements: z.array(z.string().min(1).max(32)).max(8),
  allowance: z.number().int().min(0).max(100_000_000).nullable(),
});

const catalogBody = z.strictObject({
  plans: z.array(catalogRow).min(1).max(PLAN_IDS.length),
});

function requireOperatorToken(request: Request, env: Env): void {
  const token = (env as unknown as Record<string, unknown>).MAXIMUS_OPERATOR_TOKEN;
  if (typeof token !== "string" || !token) throw new HTTPError(503, "operator_unavailable");
  const presented = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!presented) throw new HTTPError(401, "unauthorized");
  if (presented !== token) throw new HTTPError(403, "forbidden");
}

/** Code default, or the row an admin save stored. A missing table keeps the default. */
export async function planDef(env: Env, name: string): Promise<PlanDef> {
  const id = name in PLAN_CATALOG ? name : "free";
  const fallback = PLAN_CATALOG[id] ?? PLAN_CATALOG.free;
  try {
    const row = await env.DB.prepare("SELECT entitlements, allowance FROM plan_catalog WHERE id = ?")
      .bind(id)
      .first<{ entitlements: string; allowance: number | null }>();
    if (!row) return fallback;
    const parsed: unknown = JSON.parse(row.entitlements);
    if (!Array.isArray(parsed)) return fallback;
    const entitlements = parsed.filter((entry): entry is string => typeof entry === "string" && KNOWN_ENTITLEMENTS.includes(entry));
    const allowance = row.allowance === null || Number.isInteger(row.allowance) ? row.allowance : fallback.allowance;
    return { entitlements, allowance };
  } catch {
    return fallback;
  }
}

/** PUT /api/operator/plans — the operator token replaces stored allowances. */
export async function updatePlanCatalog(request: Request, env: Env): Promise<Response> {
  requireOperatorToken(request, env);
  const parsed = catalogBody.safeParse(await readBoundedJSON(request));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  const seen = new Set<string>();
  const now = Date.now();
  const statements = [];
  for (const plan of parsed.data.plans) {
    if (seen.has(plan.id)) throw new HTTPError(400, "invalid_request");
    seen.add(plan.id);
    const entitlements = [...new Set(plan.entitlements.filter((id) => KNOWN_ENTITLEMENTS.includes(id)))].sort();
    statements.push(env.DB.prepare(
      `INSERT INTO plan_catalog (id, entitlements, allowance, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET entitlements = excluded.entitlements, allowance = excluded.allowance, updated_at = excluded.updated_at`,
    ).bind(plan.id, JSON.stringify(entitlements), plan.allowance, now));
  }
  await env.DB.batch(statements);
  return contractJSON({ plans: parsed.data.plans.map((plan) => plan.id) });
}
