import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseStoredPlans, PlanStore, resolveCatalog } from "./plan-store.ts";
import { parsePlanCatalog } from "./plans.ts";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const TEAM = {
  id: "team",
  baseUsd: 20,
  allowanceUsd: 20,
  hardCapUsd: null,
  entitlements: ["admin", "budgets", "billing", "gateway"],
  display: { name: "Team", blurb: "For teams.", features: ["Shared rooms"] },
};

describe("stored plan catalog", () => {
  it("parses stored plans and drops invalid rows", () => {
    expect(parseStoredPlans({ version: 1, plans: [TEAM] })).toEqual([TEAM]);
    expect(parseStoredPlans({ version: 1, plans: [
      { ...TEAM, id: "free" },
      { ...TEAM, id: "Bad!" },
      { ...TEAM, id: "capped", hardCapUsd: 5 },
      { ...TEAM, id: "nope" },
      { junk: true },
    ] })).toEqual([{ ...TEAM, id: "free" }, { ...TEAM, id: "nope" }]);
    expect(parseStoredPlans({ version: 2, plans: [TEAM] })).toEqual([]);
    expect(parseStoredPlans(null)).toEqual([]);
  });

  it("persists plans to the data dir and reads them back", () => {
    const folder = mkdtempSync(join(tmpdir(), "maximus-plan-store-"));
    folders.push(folder);
    const store = new PlanStore({ dataDir: folder });
    expect(store.list()).toEqual([]);
    store.saveAll([TEAM]);
    expect(store.list()).toEqual([TEAM]);
    expect(new PlanStore({ dataDir: folder }).list()).toEqual([TEAM]);
  });

  it("lets stored plans override the env seed by id", () => {
    const env = parsePlanCatalog({ plans: [
      { id: "team", baseUsd: 10, allowanceUsd: 10, hardCapUsd: null, entitlements: [] },
      { id: "legacy", baseUsd: 5, allowanceUsd: 5, hardCapUsd: null, entitlements: [] },
    ] });
    const { plans, displays } = resolveCatalog(env, [TEAM]);
    expect(plans.get("team")).toMatchObject({ baseUsd: 20, allowanceUsd: 20 });
    expect(plans.get("legacy")).toMatchObject({ baseUsd: 5 });
    expect(displays.get("team")).toEqual({ name: "Team", blurb: "For teams.", features: ["Shared rooms"] });
    expect(displays.has("legacy")).toBe(false);
  });
});
