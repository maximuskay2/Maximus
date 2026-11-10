// Per-provider margin metrics: our bundled provider spend vs customer charges.
//
// BYO rows ride the user's own credentials, so they are counted (byoTurns) but
// never enter providerCostUsd or billedUsd. Only `via: "bundled"` rows can be
// our spend or our revenue. Rows whose provider is outside the frozen day-one
// roster land under "other" so no spend is ever hidden.
import { billableFor, type PriceList } from "./prices.ts";
import { instanceProvider, PROVIDER_IDS, type ProviderId } from "./switchboard.ts";
import { csvCell, type UsageRow } from "./usage-ledger.ts";

export type MarginProvider = ProviderId | "other";

/** Fallback when the instance id is not a roster default (custom instances keep their driver kind). */
const DRIVER_PROVIDER: Readonly<Record<string, ProviderId>> = {
  claudeAgent: "claude",
  codex: "codex",
  grokAgent: "grok",
  kimiAgent: "kimi",
  kimiApi: "kimi",
  meta: "muse",
  museCode: "muse",
};

export function providerOfRow(row: Pick<UsageRow, "instanceId" | "driverKind">): MarginProvider {
  return instanceProvider(row.instanceId) ?? DRIVER_PROVIDER[row.driverKind] ?? "other";
}

export interface ProviderMargin {
  provider: MarginProvider;
  /** Bundled turns: the only turns that can carry our spend or our revenue. */
  turns: number;
  /** BYO turns: shown for context, never billed, never our spend. */
  byoTurns: number;
  /** Bundled tokens. */
  input: number;
  output: number;
  /** Our provider spend for bundled turns; null when no bundled turn priced. */
  providerCostUsd: number | null;
  /** Customer charges at our sell prices; null without a sell price list. */
  billedUsd: number | null;
  /** billedUsd - providerCostUsd; null unless both sides priced. */
  marginUsd: number | null;
  /** marginUsd / billedUsd * 100; null unless billedUsd > 0 and cost priced. */
  marginPct: number | null;
  /** Bundled turns with no provider cost (no reported cost, no cost-list entry). */
  unpriced: number;
  /** Bundled turns with no sell price. */
  unbilled: number;
}

export interface MarginSummary {
  providers: ProviderMargin[];
  total: Omit<ProviderMargin, "provider">;
}

const clean = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

const money = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const empty = (provider: MarginProvider): ProviderMargin => ({
  provider,
  turns: 0,
  byoTurns: 0,
  input: 0,
  output: 0,
  providerCostUsd: null,
  billedUsd: null,
  marginUsd: null,
  marginPct: null,
  unpriced: 0,
  unbilled: 0,
});

const addMoney = (into: number | null, value: number | null): number | null =>
  value === null ? into : (into ?? 0) + value;

function finish(group: ProviderMargin): void {
  if (group.providerCostUsd !== null && group.billedUsd !== null) {
    group.marginUsd = group.billedUsd - group.providerCostUsd;
    group.marginPct = group.billedUsd > 0 ? (group.marginUsd / group.billedUsd) * 100 : null;
  }
}

/**
 * Summarize margin per provider over usage rows.
 *
 * @param sell our sell prices (operatorPrices); null leaves billedUsd null.
 * @param cost provider cost list (LIST_PRICES); used only when a bundled row
 * carries no reported costUsd. Rows priced neither way count as unpriced.
 */
export function summarizeMargin(
  rows: readonly UsageRow[],
  sell: PriceList | null,
  cost: PriceList | null = null,
): MarginSummary {
  const groups = new Map<MarginProvider, ProviderMargin>();
  const total = empty("other");
  for (const row of rows) {
    const provider = providerOfRow(row);
    let group = groups.get(provider);
    if (!group) {
      group = empty(provider);
      groups.set(provider, group);
    }
    if (row.via !== "bundled") {
      group.byoTurns += 1;
      total.byoTurns += 1;
      continue;
    }
    group.turns += 1;
    total.turns += 1;
    group.input += clean(row.input);
    total.input += clean(row.input);
    group.output += clean(row.output);
    total.output += clean(row.output);
    const reported = money(row.costUsd);
    const costUsd = reported ?? (cost ? billableFor(row, cost) : null);
    if (costUsd === null) {
      group.unpriced += 1;
      total.unpriced += 1;
    } else {
      group.providerCostUsd = addMoney(group.providerCostUsd, costUsd);
      total.providerCostUsd = addMoney(total.providerCostUsd, costUsd);
    }
    const billed = sell ? billableFor(row, sell) : null;
    if (billed === null) {
      group.unbilled += 1;
      total.unbilled += 1;
    } else {
      group.billedUsd = addMoney(group.billedUsd, billed);
      total.billedUsd = addMoney(total.billedUsd, billed);
    }
  }
  const order = [...PROVIDER_IDS, "other"] as const;
  const providers = [...groups.values()];
  providers.sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
  for (const group of providers) finish(group);
  finish(total);
  return {
    providers,
    total: {
      turns: total.turns,
      byoTurns: total.byoTurns,
      input: total.input,
      output: total.output,
      providerCostUsd: total.providerCostUsd,
      billedUsd: total.billedUsd,
      marginUsd: total.marginUsd,
      marginPct: total.marginPct,
      unpriced: total.unpriced,
      unbilled: total.unbilled,
    },
  };
}

export function marginCsv(summary: MarginSummary): string {
  const header = [
    "provider", "bundled_turns", "byo_turns", "input_tokens", "output_tokens",
    "provider_cost_usd", "billed_usd", "margin_usd", "margin_pct", "unpriced", "unbilled",
  ];
  const line = (group: Omit<ProviderMargin, "provider">, label: string): string =>
    [
      label,
      group.turns,
      group.byoTurns,
      group.input,
      group.output,
      group.providerCostUsd,
      group.billedUsd,
      group.marginUsd,
      group.marginPct,
      group.unpriced,
      group.unbilled,
    ].map(csvCell).join(",");
  const lines = [header.join(",")];
  for (const group of summary.providers) lines.push(line(group, group.provider));
  lines.push(line(summary.total, "total"));
  return lines.join("\n") + "\n";
}
