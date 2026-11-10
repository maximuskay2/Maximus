// Operator margin dashboard data: GET /api/admin/usage/margin (+ .csv).
// Owner/admin only (ownerOrAdmin; the auth gate already defaults unknown paths
// to the admin scope). Reads the usage ledger for the range and prices bundled
// rows at our sell list vs provider cost (server/margin-metrics.ts).
import { LIST_PRICES } from "../model-prices.ts";
import { marginCsv, summarizeMargin } from "../margin-metrics.ts";
import type { PriceList } from "../prices.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { flushUsageLedger, parseUsageRange, readUsage } from "../usage-ledger.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface MarginRouteDeps {
  dataDir: string;
  sellPrices(): PriceList | null;
  /** Overage sell card. Operator prices win when both name the same model. */
  fallbackSell?: () => PriceList | null;
  currency(): string;
}

function mergeSell(operator: PriceList | null, extra: PriceList | null): PriceList | null {
  if (!extra) return operator;
  if (!operator) return extra;
  return { ...extra, ...operator };
}

export function createMarginRoutes(deps: MarginRouteDeps): RouteHandler {
  // Vendor rate card ≈ our bundled provider spend; rows with a reported
  // costUsd take precedence inside summarizeMargin.
  const cost: PriceList = { ...LIST_PRICES };
  return async ({ res, url, path, method, auth, json }) => {
    if (!(method === "GET" && (path === "/api/admin/usage/margin" || path === "/api/admin/usage/margin.csv"))) return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only an admin can read margin metrics." });
    const range = parseUsageRange(url.searchParams.get("from"), url.searchParams.get("to"));
    if (!range) return json(res, 400, { error: "from and to must be YYYY-MM-DD, from no later than to, at most a year apart" });
    await flushUsageLedger(deps.dataDir);
    const summary = summarizeMargin(readUsage(deps.dataDir, range), mergeSell(deps.sellPrices(), deps.fallbackSell?.() ?? null), cost);
    if (path.endsWith(".csv")) {
      const stamp = (date: Date) => date.toISOString().slice(0, 10);
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="margin-${stamp(range.from)}-${stamp(range.to)}.csv"`,
        "cache-control": "no-store",
      });
      res.end(marginCsv(summary));
      return;
    }
    res.setHeader("cache-control", "no-store");
    return json(res, 200, {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      currency: deps.currency(),
      ...summary,
    });
  };
}
