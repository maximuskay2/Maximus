// Image is $0.01. Web search is $2.50 per 1,000. Both spend the hosted Muse
// wallet. Free and bring-your-own are refused. No charge until a ration is bound.
import { liveRation } from "./ration-service.ts";
import { rationWorkspace } from "./ration.ts";

export const IMAGE_USD = 0.01;
export const SEARCH_USD = 0.0025;

export function chargeAddon(amountUsd: number): { status: number; error: string } | null {
  const held = liveRation();
  if (!held) return null;
  const refusal = held.debitAddon(rationWorkspace(), amountUsd);
  return refusal ? { status: refusal.status, error: refusal.message } : null;
}
