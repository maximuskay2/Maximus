// Pushes the admin ration to the worker catalog. The one-time free grant stays
// on the harness wallet; the worker's free row has no monthly allowance.
import { resolveCompanionControlPlaneURL } from "../../electron/companion-account-service.mjs";
import { hostedTier, plansFromRation, type RationProfile } from "./ration.ts";

export interface WorkerPlanRow {
  id: string;
  entitlements: string[];
  allowance: number | null;
}

const cents = (usd: number): number => Math.round(usd * 100);

/** Worker rows for one ration save. Team is the phone Plus seat; Business is phone Pro. */
export function workerPlansFromRation(profile: RationProfile): WorkerPlanRow[] {
  const plus = hostedTier(profile, "plus");
  const pro = hostedTier(profile, "pro");
  const rows: WorkerPlanRow[] = plansFromRation(profile).map((plan) => ({
    id: plan.id,
    entitlements: plan.entitlements,
    allowance: plan.id === "free" ? null : cents(plan.allowanceUsd),
  }));
  if (plus) {
    rows.push({ id: "team", entitlements: ["admin", "budgets", "billing", "gateway", "agentOsMachines"], allowance: cents(plus.includedCostUsd) });
  }
  if (pro) {
    rows.push({
      id: "business",
      entitlements: ["whitelabel", "sso", "admin", "budgets", "billing", "gateway", "agentOsMachines"],
      allowance: cents(pro.includedCostUsd),
    });
  }
  return rows;
}

/** True when the worker accepted the catalog. Missing token or URL is a no-op. */
export async function pushWorkerPlanCatalog(profile: RationProfile, options: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  baseURL?: string;
} = {}): Promise<boolean> {
  const env = options.env ?? process.env;
  const token = env.MAXIMUS_OPERATOR_TOKEN?.trim() ?? "";
  if (!token) return false;
  const baseURL = options.baseURL ?? resolveCompanionControlPlaneURL({ isPackaged: true, environment: env, configuredURL: "" });
  if (!baseURL) return false;
  const response = await (options.fetchImpl ?? fetch)(`${baseURL}/api/operator/plans`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ plans: workerPlansFromRation(profile) }),
    signal: AbortSignal.timeout(10_000),
  });
  return response.ok;
}
