const KEY = "maximus.pending-plan";

/** Remembers a pricing-page plan across signup / OAuth so the app can finish the choice. */
export function rememberPendingPlan(planId: string): void {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(planId)) return;
  try { sessionStorage.setItem(KEY, planId); } catch { /* private windows still choose after reload */ }
}

export function takePendingPlan(): string | null {
  try {
    const plan = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return plan && /^[a-z][a-z0-9-]{1,30}$/.test(plan) ? plan : null;
  } catch {
    return null;
  }
}

export function accountChoiceFromPlan(planId: string): "free" | "byo" | "muse" {
  if (planId === "byo") return "byo";
  if (planId === "free") return "free";
  return "muse";
}
