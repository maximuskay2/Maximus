import { describe, expect, it } from "vitest";

import { marginCsv, providerOfRow, summarizeMargin } from "./margin-metrics.ts";
import type { PriceList } from "./prices.ts";
import type { UsageRow } from "./usage-ledger.ts";

const SELL: PriceList = {
  "claude-sonnet-5": { inputPerMillion: 4, outputPerMillion: 20 },
  "gpt-5.4": { inputPerMillion: 5, outputPerMillion: 30 },
  default: { inputPerMillion: 10, outputPerMillion: 10 },
};
const COST: PriceList = {
  "claude-sonnet-5": { inputPerMillion: 2, outputPerMillion: 10 },
  "gpt-5.4": { inputPerMillion: 2.5, outputPerMillion: 15 },
  default: { inputPerMillion: 5, outputPerMillion: 5 },
};

const row = (over: Partial<UsageRow> & { instanceId: string; driverKind: string; model: string }): UsageRow => ({
  at: "2026-11-01T10:00:00.000Z",
  botId: "b1",
  botName: "Bot",
  threadId: "t1",
  input: 0,
  output: 0,
  costUsd: null,
  trigger: { kind: "owner" },
  ...over,
});

describe("providerOfRow", () => {
  it("maps roster instances first", () => {
    expect(providerOfRow({ instanceId: "claude", driverKind: "whatever" })).toBe("claude");
    expect(providerOfRow({ instanceId: "codex", driverKind: "whatever" })).toBe("codex");
    expect(providerOfRow({ instanceId: "chatgpt", driverKind: "whatever" })).toBe("codex");
    expect(providerOfRow({ instanceId: "grok", driverKind: "whatever" })).toBe("grok");
    expect(providerOfRow({ instanceId: "kimiApi", driverKind: "whatever" })).toBe("kimi");
    expect(providerOfRow({ instanceId: "museCode", driverKind: "whatever" })).toBe("muse");
  });
  it("falls back to driver kind, else other", () => {
    expect(providerOfRow({ instanceId: "custom-claude", driverKind: "claudeAgent" })).toBe("claude");
    expect(providerOfRow({ instanceId: "custom", driverKind: "kimiAgent" })).toBe("kimi");
    expect(providerOfRow({ instanceId: "custom", driverKind: "meta" })).toBe("muse");
    expect(providerOfRow({ instanceId: "custom", driverKind: "geminiAgent" })).toBe("other");
  });
});

describe("summarizeMargin", () => {
  it("prices bundled rows at sell vs reported cost", () => {
    const summary = summarizeMargin(
      [row({ instanceId: "claude", driverKind: "claudeAgent", model: "claude-sonnet-5", input: 1_000_000, output: 100_000, costUsd: 4, via: "bundled" })],
      SELL,
      COST,
    );
    // Billed: 1M*4 + 100k*20 = 6. Cost reported: 4. Margin 2 = 33.33%.
    expect(summary.providers.map((p) => p.provider)).toEqual(["claude"]);
    expect(summary.providers[0]).toMatchObject({ turns: 1, byoTurns: 0, input: 1_000_000, output: 100_000, providerCostUsd: 4, billedUsd: 6, marginUsd: 2, unpriced: 0, unbilled: 0 });
    expect(summary.providers[0]!.marginPct).toBeCloseTo(33.333, 3);
    expect(summary.total).toMatchObject({ turns: 1, providerCostUsd: 4, billedUsd: 6, marginUsd: 2 });
  });
  it("falls back to the cost list when no cost was reported", () => {
    const summary = summarizeMargin(
      [row({ instanceId: "codex", driverKind: "codex", model: "gpt-5.4", input: 1_000_000, output: 0, costUsd: null, via: "bundled" })],
      SELL,
      COST,
    );
    // Cost: 1M*2.5 = 2.5. Billed: 1M*5 = 5.
    expect(summary.providers[0]).toMatchObject({ provider: "codex", providerCostUsd: 2.5, billedUsd: 5, marginUsd: 2.5, unpriced: 0 });
  });
  it("counts BYO and legacy rows as unbilled context, never spend", () => {
    const summary = summarizeMargin(
      [
        row({ instanceId: "claude", driverKind: "claudeAgent", model: "claude-sonnet-5", input: 1_000_000, output: 0, costUsd: 99, via: "byo" }),
        row({ instanceId: "claude", driverKind: "claudeAgent", model: "claude-sonnet-5", input: 1_000_000, output: 0, costUsd: 99 }),
      ],
      SELL,
      COST,
    );
    expect(summary.providers[0]).toMatchObject({ turns: 0, byoTurns: 2, providerCostUsd: null, billedUsd: null, marginUsd: null, marginPct: null });
    expect(summary.total).toMatchObject({ turns: 0, byoTurns: 2, providerCostUsd: null, billedUsd: null });
  });
  it("keeps unknown providers visible under other", () => {
    const summary = summarizeMargin(
      [row({ instanceId: "gem", driverKind: "geminiAgent", model: "gemini-x", input: 1_000_000, output: 1_000_000, costUsd: 1, via: "bundled" })],
      SELL,
      COST,
    );
    // Both sides fall to `default`: billed 20, cost 1 (reported wins).
    expect(summary.providers.map((p) => p.provider)).toEqual(["other"]);
    expect(summary.providers[0]).toMatchObject({ billedUsd: 20, providerCostUsd: 1, marginUsd: 19 });
  });
  it("tracks unpriced and unbilled bundled turns without hiding the rest", () => {
    const summary = summarizeMargin(
      [
        row({ instanceId: "zzz", driverKind: "zzzAgent", model: "zzz-1", input: 10, output: 10, costUsd: null, via: "bundled" }),
        row({ instanceId: "claude", driverKind: "claudeAgent", model: "claude-sonnet-5", input: 1_000_000, output: 0, costUsd: 2, via: "bundled" }),
      ],
      null,
      null,
    );
    expect(summary.total).toMatchObject({ turns: 2, providerCostUsd: 2, billedUsd: null, marginUsd: null, unpriced: 1, unbilled: 2 });
    const other = summary.providers.find((p) => p.provider === "other")!;
    expect(other).toMatchObject({ unpriced: 1, unbilled: 1, providerCostUsd: null });
  });
  it("orders providers by roster, other last", () => {
    const summary = summarizeMargin(
      [
        row({ instanceId: "x", driverKind: "zzzAgent", model: "m", input: 1, output: 0, costUsd: 1, via: "bundled" }),
        row({ instanceId: "grok", driverKind: "grokAgent", model: "m", input: 1, output: 0, costUsd: 1, via: "bundled" }),
        row({ instanceId: "claude", driverKind: "claudeAgent", model: "m", input: 1, output: 0, costUsd: 1, via: "bundled" }),
      ],
      null,
      null,
    );
    expect(summary.providers.map((p) => p.provider)).toEqual(["claude", "grok", "other"]);
  });
});

describe("marginCsv", () => {
  it("emits one row per provider plus a total", () => {
    const summary = summarizeMargin(
      [row({ instanceId: "claude", driverKind: "claudeAgent", model: "claude-sonnet-5", input: 1_000_000, output: 0, costUsd: 2, via: "bundled" })],
      SELL,
      COST,
    );
    const lines = marginCsv(summary).trim().split("\n");
    expect(lines[0]).toBe("provider,bundled_turns,byo_turns,input_tokens,output_tokens,provider_cost_usd,billed_usd,margin_usd,margin_pct,unpriced,unbilled");
    expect(lines[1]).toBe("claude,1,0,1000000,0,2,4,2,50,0,0");
    expect(lines[2]).toBe("total,1,0,1000000,0,2,4,2,50,0,0");
  });
});
