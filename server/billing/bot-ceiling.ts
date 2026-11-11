import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = "bot-spend.json";

function readAll(dataDir: string): Record<string, number> {
  try {
    const value: unknown = JSON.parse(readFileSync(join(dataDir, FILE), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, number> = {};
    for (const [botId, spent] of Object.entries(value)) {
      if (typeof spent === "number" && Number.isFinite(spent) && spent >= 0) out[botId] = spent;
    }
    return out;
  } catch {
    return {};
  }
}

export function readBotSpend(dataDir: string, botId: string): number {
  return readAll(dataDir)[botId] ?? 0;
}

export function noteBotSpend(dataDir: string, botId: string, usd: number): void {
  if (!(usd > 0)) return;
  const all = readAll(dataDir);
  all[botId] = (all[botId] ?? 0) + usd;
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, FILE), JSON.stringify(all));
}

export function botSpendRefusal(spentUsd: number, ceilingUsd: number): { message: string; code: "spend_cap" } | null {
  if (spentUsd < ceilingUsd) return null;
  return {
    code: "spend_cap",
    message: "This bot has reached its own spend ceiling. Other bots here can still run.",
  };
}
