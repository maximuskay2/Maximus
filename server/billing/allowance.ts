// Hybrid bundled engine: base subscription + monthly allowance + per-token
// overage at our sell prices. Only `via: "bundled"` ledger rows count — BYO
// rows and legacy rows without a path never bill. Allowance-exhausted turns
// keep running and accrue overage; only the hard cap refuses, with the same
// spend_cap 409 + admin raise path as the workspace budget in spend.ts.
import { billableFor, type PriceList } from "../prices.ts";
import { readUsage, type UsageRow } from "../usage-ledger.ts";

export interface BundledBudgetState {
  month: string;
  allowanceUsd: number;
  /** Bundled billable spend month-to-date, USD, reconciled to the cent. */
  spentUsd: number;
  /** Spend past the allowance; zero while inside it. */
  overageUsd: number;
  hardCapUsd: number | null;
  percent: number;
  withinAllowance: boolean;
  capExceeded: boolean;
}

const CACHE_MS = 15_000;
const cache = new Map<string, { at: number; month: string; spentUsd: number; fingerprint: string }>();

export function resetBundledBudgetCacheForTests(): void {
  cache.clear();
}

const monthOf = (now: Date): string => now.toISOString().slice(0, 7);
const cents = (value: number): number => Math.round(value * 100) / 100;

/** Bundled billable spend across rows, at our sell prices. Unpriced rows contribute nothing (never guessed). */
export function bundledSpendOverRows(rows: readonly UsageRow[], prices: PriceList | null): number {
  if (!prices) return 0;
  let total = 0;
  for (const row of rows) {
    if (row.via !== "bundled") continue;
    total += billableFor(row, prices) ?? 0;
  }
  return cents(total);
}

export function bundledSpendMonthToDate(dataDir: string, prices: PriceList | null, now = new Date()): number {
  if (!prices) return 0;
  const month = monthOf(now);
  const fingerprint = JSON.stringify(prices);
  const read = cache.get(dataDir);
  if (read && read.month === month && read.fingerprint === fingerprint && now.getTime() - read.at < CACHE_MS) return read.spentUsd;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const spentUsd = bundledSpendOverRows(readUsage(dataDir, { from, to: now }), prices);
  cache.set(dataDir, { at: now.getTime(), month, spentUsd, fingerprint });
  return spentUsd;
}

export function bundledBudgetState(
  allowanceUsd: number,
  hardCapUsd: number | null,
  dataDir: string,
  prices: PriceList | null,
  now = new Date(),
): BundledBudgetState {
  const spentUsd = bundledSpendMonthToDate(dataDir, prices, now);
  const overageUsd = cents(Math.max(0, spentUsd - allowanceUsd));
  const capExceeded = hardCapUsd !== null && spentUsd >= hardCapUsd;
  return {
    month: monthOf(now),
    allowanceUsd,
    spentUsd,
    overageUsd,
    hardCapUsd,
    percent: allowanceUsd > 0 ? Math.min(999, Math.round((spentUsd / allowanceUsd) * 100)) : spentUsd > 0 ? 999 : 0,
    withinAllowance: spentUsd < allowanceUsd,
    capExceeded,
  };
}

const usd = (value: number): string =>
  Number.isInteger(Math.round(value * 1000) / 10) ? value.toFixed(2) : value.toFixed(3);

/** Past the hard cap bundled turns refuse exactly like a workspace budget breach: spend_cap 409, admin raises it. */
export function assertWithinBundledBudget(state: BundledBudgetState): void {
  if (!state.capExceeded || state.hardCapUsd === null) return;
  throw Object.assign(
    new Error(`this workspace has reached its bundled limit of $${usd(state.hardCapUsd)} for ${state.month} — an admin can raise it under Settings → Usage`),
    { status: 409, code: "spend_cap" },
  );
}
