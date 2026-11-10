import { describe, expect, it } from "vitest";

import { minorToUsd, parsePlanCatalog, planCatalogFromEnv } from "./plans.ts";

describe("bundled plan catalog", () => {
  it("parses operator catalog JSON and drops invalid plans", () => {
    const catalog = parsePlanCatalog({
      plans: [
        { id: "maximus-pro", baseUsd: 49, allowanceUsd: 200, hardCapUsd: 500, entitlements: ["gateway"] },
        { id: "bad-cap", baseUsd: 1, allowanceUsd: 10, hardCapUsd: 5, entitlements: [] },
        { id: "", baseUsd: -1, allowanceUsd: 0, hardCapUsd: null, entitlements: [] },
      ],
    });
    expect([...catalog.keys()]).toEqual(["maximus-pro"]);
    expect(planCatalogFromEnv({ MAXIMUS_BILLING_PLANS: JSON.stringify({ plans: [] }) }).size).toBe(0);
    expect(planCatalogFromEnv({}).size).toBe(0);
    expect(planCatalogFromEnv({ MAXIMUS_BILLING_PLANS: "{broken" }).size).toBe(0);
  });

  it("converts minor webhook units to USD and fails unknown currencies closed", () => {
    expect(minorToUsd(20000, "USD")).toBe(200);
    expect(minorToUsd(20000, "ngn")).toBe(200);
    expect(minorToUsd(500, "JPY")).toBe(500);
    expect(minorToUsd(100, "XXX")).toBeNull();
    expect(minorToUsd(-1, "USD")).toBeNull();
  });
});
