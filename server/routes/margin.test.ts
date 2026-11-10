import { mkdtempSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { PriceList } from "../prices.ts";
import type { RequestAuth } from "../request-auth.ts";
import { appendUsage, flushUsageLedger } from "../usage-ledger.ts";
import { createMarginRoutes } from "./margin.ts";
import { PASS, type RouteContext } from "./table.ts";

const SELL: PriceList = {
  "claude-sonnet-5": { inputPerMillion: 4, outputPerMillion: 20 },
};

const authFor = (admin: boolean): RequestAuth =>
  ({ kind: "session", scopes: admin ? ["admin", "client"] : ["client"] }) as unknown as RequestAuth;

function ctxFor(path: string, admin = true): { ctx: RouteContext; sent: Array<{ status: number; body: unknown }>; ended: string[] } {
  const sent: Array<{ status: number; body: unknown }> = [];
  const ended: string[] = [];
  const res = {
    setHeader: () => {},
    writeHead: () => {},
    end: (text: string) => void ended.push(text),
  } as unknown as ServerResponse;
  const ctx = {
    req: { headers: {} } as IncomingMessage,
    res,
    url: new URL(path, "http://localhost"),
    path: path.split("?")[0]!,
    method: "GET",
    auth: authFor(admin),
    json: ((_res: ServerResponse, status: number, b: unknown) => {
      sent.push({ status, body: b });
    }) as RouteContext["json"],
    readBody: (() => { throw new Error("no body"); }) as RouteContext["readBody"],
  };
  return { ctx, sent, ended };
}

async function seed(dataDir: string): Promise<void> {
  await appendUsage(dataDir, {
    at: "2026-11-03T10:00:00.000Z",
    botId: "b1", botName: "Bot", threadId: "t1", instanceId: "claude", driverKind: "claudeAgent",
    model: "claude-sonnet-5", input: 1_000_000, output: 0, costUsd: 2, trigger: { kind: "owner" }, via: "bundled",
  });
  await appendUsage(dataDir, {
    at: "2026-11-03T11:00:00.000Z",
    botId: "b1", botName: "Bot", threadId: "t2", instanceId: "claude", driverKind: "claudeAgent",
    model: "claude-sonnet-5", input: 500_000, output: 0, costUsd: 1, trigger: { kind: "owner" }, via: "byo",
  });
  await flushUsageLedger(dataDir);
}

describe("margin routes", () => {
  it("reports per-provider margin for admins", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "margin-routes-"));
    await seed(dataDir);
    const handler = createMarginRoutes({ dataDir, sellPrices: () => SELL, currency: () => "USD" });
    const { ctx, sent } = ctxFor("/api/admin/usage/margin?from=2026-11-01&to=2026-11-30");
    const out = await handler(ctx);
    expect(out).not.toBe(PASS);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.status).toBe(200);
    const body = sent[0]!.body as { currency: string; providers: Array<{ provider: string; turns: number; byoTurns: number; providerCostUsd: number; billedUsd: number; marginUsd: number }> };
    expect(body.currency).toBe("USD");
    expect(body.providers).toHaveLength(1);
    // Bundled 1M in at sell 4/M = 4 billed vs 2 reported cost; the BYO row counts but never bills.
    expect(body.providers[0]).toMatchObject({ provider: "claude", turns: 1, byoTurns: 1, providerCostUsd: 2, billedUsd: 4, marginUsd: 2 });
  });
  it("refuses non-admins", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "margin-routes-"));
    const handler = createMarginRoutes({ dataDir, sellPrices: () => SELL, currency: () => "USD" });
    const { ctx, sent } = ctxFor("/api/admin/usage/margin", false);
    await handler(ctx);
    expect(sent).toEqual([{ status: 403, body: { error: "Only an admin can read margin metrics." } }]);
  });
  it("rejects bad ranges and passes other paths through", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "margin-routes-"));
    const handler = createMarginRoutes({ dataDir, sellPrices: () => SELL, currency: () => "USD" });
    const bad = ctxFor("/api/admin/usage/margin?from=2026-13-01");
    await handler(bad.ctx);
    expect(bad.sent[0]!.status).toBe(400);
    const other = ctxFor("/api/usage");
    expect(await handler(other.ctx)).toBe(PASS);
    expect(other.sent).toEqual([]);
  });
  it("exports the same summary as CSV", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "margin-routes-"));
    await seed(dataDir);
    const handler = createMarginRoutes({ dataDir, sellPrices: () => SELL, currency: () => "USD" });
    const { ctx, sent, ended } = ctxFor("/api/admin/usage/margin.csv?from=2026-11-01&to=2026-11-30");
    await handler(ctx);
    expect(sent).toEqual([]);
    expect(ended).toHaveLength(1);
    expect(ended[0]).toContain("provider,bundled_turns,byo_turns");
    expect(ended[0]).toContain("claude,1,1,1000000,0,2,4,2,50,0,0");
  });
});
