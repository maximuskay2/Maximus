import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { summarizeMargin } from "../margin-metrics.ts";
import { LIST_PRICES } from "../model-prices.ts";
import type { UsageRow } from "../usage-ledger.ts";
import { pushWorkerPlanCatalog, workerPlansFromRation } from "./catalog-sync.ts";
import { DEFAULT_RATION, debitUsd, outputTokensFor, plansFromRation, rateFor, rationPreview, rationProblems, rationWorkspace } from "./ration.ts";
import { RationService } from "./ration-service.ts";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function service(): RationService {
  const folder = mkdtempSync(join(tmpdir(), "maximus-ration-"));
  folders.push(folder);
  return new RationService({ dataDir: folder });
}

describe("ration rates", () => {
  it("prices a turn from input, cache, and output", () => {
    const spark = rateFor(DEFAULT_RATION, "muse-spark-1.3")!;
    expect(debitUsd({ freshInput: 8_000, cachedInput: 12_000, output: 800 }, spark)).toBeCloseTo(0.0152, 6);
    expect(outputTokensFor(0.012, spark.outputPerMillion)).toBe(2_823);
    expect(rationPreview(DEFAULT_RATION).freeOutputTokens).toBe(60_000);
  });

  it("bills the checkout workspace, or local when that id is unset", () => {
    expect(rationWorkspace({})).toBe("local");
    expect(rationWorkspace({ MAXIMUS_ADMIN_WORKSPACE: "acme" })).toBe("acme");
    expect(rationWorkspace({ MAXIMUS_ADMIN_WORKSPACE: "../private" })).toBe("local");
  });

  it("uses the long Ember rate past 200k input tokens", () => {
    expect(rateFor(DEFAULT_RATION, "muse-ember-1.0", 200_001)?.id).toBe("muse-ember-1.0-long");
    expect(rateFor(DEFAULT_RATION, "muse-ember-1.0", 200_000)?.outputPerMillion).toBe(0.5);
  });

  it("rejects a plan whose Muse cost is more than half the price", () => {
    const broken = structuredClone(DEFAULT_RATION);
    broken.hosted[0]!.includedCostUsd = 10;
    broken.hosted[0]!.hardCapUsd = 10;
    expect(rationProblems(broken)).toMatch(/half the monthly price/);
    const close = structuredClone(DEFAULT_RATION);
    close.byoPriceUsd = 12;
    expect(rationProblems(close)).toMatch(/at least \$8 below Starter/);
  });
});

describe("ration wallet", () => {
  it("grants $0.012 once, debits a bundled turn, and ignores a replayed invoice", () => {
    const ration = service();
    const first = ration.ensureFree("acme");
    expect(first.grantedUsd).toBe(0.012);
    expect(ration.ensureFree("acme").grantedUsd).toBe(0.012);
    const rate = rateFor(DEFAULT_RATION, "muse-spark-1.3-contributor")!;
    const cost = debitUsd({ freshInput: 100, cachedInput: 0, output: 40 }, rate);
    expect(ration.debit("acme", "muse-spark-1.3-contributor", { freshInput: 100, cachedInput: 0, output: 40 })).toBeNull();
    expect(ration.wallet("acme").spentUsd).toBeCloseTo(cost, 6);
    ration.grantPaid("acme", "starter", "stripe:evt_1");
    expect(ration.wallet("acme")).toMatchObject({ tier: "starter", grantedUsd: 8, spentUsd: 0 });
    ration.debit("acme", "muse-spark-1.3", { freshInput: 0, cachedInput: 0, output: 1_000 });
    ration.grantPaid("acme", "starter", "stripe:evt_1");
    expect(ration.wallet("acme").spentUsd).toBeGreaterThan(0);
    ration.grantPaid("acme", "starter", "stripe:evt_2");
    expect(ration.wallet("acme").spentUsd).toBe(0);
  });

  it("refuses Wonder on the free grant before any debit", () => {
    const ration = service();
    const refusal = ration.preflight("acme", "muse-wonder-1.0", JSON.stringify({ model: "muse-wonder-1.0" }));
    expect(refusal).toMatchObject({ status: 403, code: "model_locked" });
    expect(ration.wallet("acme").spentUsd).toBe(0);
  });

  it("stops a free grant that cannot cover the prompt", () => {
    const ration = service();
    const tiny = structuredClone(DEFAULT_RATION);
    tiny.freeGrantUsd = 0.0001;
    expect(ration.saveProfile(tiny)).toBeNull();
    const heavy = JSON.stringify({ model: "muse-spark-1.3-contributor", text: "x".repeat(50_000) });
    const refusal = ration.preflight("acme", "muse-spark-1.3-contributor", heavy);
    expect(refusal?.code).toBe("spend_cap");
  });

  it("gives each signup email its own free grant, once", () => {
    const ration = service();
    const now = new Date("2026-11-10T12:00:00Z");
    const ada = ration.ensureFree("local", now, { email: "Ada@example.com", installId: "phone-1" });
    expect(ada.grantedUsd).toBe(0.012);
    expect(ada.workspace).toBe("free:ada@example.com");
    expect(ration.ensureFree("local", now, { email: "ada@example.com" }).grantedUsd).toBe(0.012);
    expect(ration.ensureFree("local", now, { email: "ada@example.com" }).spentUsd).toBe(0);
    expect(ration.ensureFree("other-host", now, { installId: "phone-1" }).grantedUsd).toBe(0);
    expect(ration.ensureFree("local", now, { email: "bob@example.com", installId: "phone-1" }).grantedUsd).toBe(0);
    expect(ration.freeGrantOpen({ email: "bob@example.com", installId: "phone-1" })).toBe(false);
    expect(ration.ensureFree("local", now, { email: "Ada.O+2@gmail.com", installId: "laptop-9" }).grantedUsd).toBe(0.012);
    expect(ration.ensureFree("local", now, { email: "adao@googlemail.com" }).workspace).toBe("free:adao@gmail.com");
    const bob = ration.ensureFree("local", now, { email: "carol@example.com" });
    expect(bob.grantedUsd).toBe(0.012);
    expect(bob.workspace).toBe("free:carol@example.com");
    expect(ration.debit("local", "muse-spark-1.3-contributor", { freshInput: 100, cachedInput: 0, output: 40 }, now, { email: "ada@example.com" })).toBeNull();
    expect(ration.wallet("free:ada@example.com").spentUsd).toBeGreaterThan(0);
    expect(ration.wallet("free:carol@example.com").spentUsd).toBe(0);
    expect(ration.wallet("local").spentUsd).toBe(0);
  });

  it("opts free wallets into Contributor Spark when the profile allows it", () => {
    const ration = service();
    expect(ration.ensureFree("acme").contributor).toBe(true);
    expect(ration.preflight("acme", "muse-spark-1.3-contributor", "{}")).toBeNull();
    expect(ration.preflight("acme", "muse-spark-1.3", "{}")?.code).toBe("model_locked");
    ration.acceptContributor("acme", false);
    expect(ration.preflight("acme", "muse-spark-1.3-contributor", "{}")?.code).toBe("model_locked");
    expect(ration.preflight("acme", "muse-spark-1.3", "{}")).toBeNull();
    expect(ration.walletView("acme").sparkTokens).toBe(2_823);
  });

  it("spends a signed-in free chat until the daily limit, and leaves an unpaid email alone", () => {
    const ration = service();
    const now = new Date("2026-11-10T12:00:00Z");
    expect(ration.chargeChat("local", "ada@example.com", "hello", now)).toBeNull();
    expect(ration.wallet("local").spentUsd).toBe(0);
    expect(ration.wallet("free:ada@example.com").spentUsd).toBe(0);
    ration.chooseAccount("ada@example.com", "free");
    expect(ration.chargeChat("local", "ada@example.com", "hello", now)).toBeNull();
    expect(ration.wallet("local").spentUsd).toBe(0);
    expect(ration.wallet("free:ada@example.com").spentUsd).toBeGreaterThan(0);
    for (let i = 0; i < 18; i += 1) expect(ration.chargeChat("local", "ada@example.com", "hello", now)).toBeNull();
    expect(ration.chargeChat("local", "ada@example.com", "hello", now)).toBeNull();
    expect(ration.chargeChat("local", "ada@example.com", "hello", now)?.code).toBe("rate_limit");
  });

  it("does not debit a bring-your-own wallet when that email chats", () => {
    const ration = service();
    const now = new Date("2026-11-10T12:00:00Z");
    ration.chooseAccount("ada@example.com", "byo");
    ration.grantPaid("local", "byo", "evt-byo-chat", now);
    expect(ration.chargeChat("local", "ada@example.com", "hello", now)).toBeNull();
    expect(ration.wallet("local").spentUsd).toBe(0);
  });

  it("caps bring-your-own by the hour and does not debit that wallet", () => {
    const ration = service();
    const now = new Date("2026-11-10T12:00:00Z");
    ration.grantPaid("acme", "byo", "evt-byo", now);
    expect(ration.debit("acme", "muse-spark-1.3", { freshInput: 1_000, cachedInput: 0, output: 100 })).toBeNull();
    expect(ration.wallet("acme").spentUsd).toBe(0);
    for (let i = 0; i < 60; i += 1) expect(ration.admitByo("acme", now)).toBeNull();
    expect(ration.admitByo("acme", now)?.code).toBe("rate_limit");
    expect(ration.admitByo("acme", new Date("2026-11-10T13:00:00Z"))).toBeNull();
  });

  it("charges a hosted image and leaves the free grant untouched", () => {
    const ration = service();
    expect(ration.debitAddon("acme", 0.01)?.code).toBe("model_locked");
    expect(ration.wallet("acme").freeUsed).toBe(false);
    ration.grantPaid("byo-seat", "byo", "evt-byo-image");
    expect(ration.debitAddon("byo-seat", 0.01)).toBeNull();
    expect(ration.wallet("byo-seat").spentUsd).toBe(0);
    ration.grantPaid("acme", "starter", "evt-starter");
    expect(ration.debitAddon("acme", 0.01)).toBeNull();
    expect(ration.wallet("acme").spentUsd).toBeCloseTo(0.01, 6);
  });

  it("lets overage spend up to twice the included cost", async () => {
    const ration = service();
    const profile = structuredClone(DEFAULT_RATION);
    profile.overageEnabled = true;
    expect(ration.saveProfile(profile)).toBeNull();
    ration.grantPaid("acme", "starter", "evt-over");
    expect(ration.debit("acme", "muse-spark-1.3", { freshInput: 0, cachedInput: 0, output: 3_000_000 })).toBeNull();
    expect(ration.wallet("acme").spentUsd).toBeCloseTo(12.75, 6);
    expect(ration.debit("acme", "muse-spark-1.3", { freshInput: 0, cachedInput: 0, output: 2_000_000 })?.code).toBe("spend_cap");
    expect(ration.wallet("acme").spentUsd).toBeCloseTo(12.75, 6);
    expect(plansFromRation(DEFAULT_RATION).find((plan) => plan.id === "free")).toMatchObject({
      allowanceUsd: 0.012,
      hardCapUsd: 0.012,
      baseUsd: 0,
      display: { features: expect.arrayContaining(["Web, desktop, and phone"]) },
    });
    expect(plansFromRation(DEFAULT_RATION).find((plan) => plan.id === "starter")).toMatchObject({
      hardCapUsd: 8,
      display: { features: expect.arrayContaining(["Web, desktop, and phone"]) },
    });
    expect(plansFromRation(DEFAULT_RATION).find((plan) => plan.id === "byo")?.display.features).toContain("Web, desktop, and phone");
    expect(workerPlansFromRation(DEFAULT_RATION)).toEqual(expect.arrayContaining([
      { id: "free", entitlements: ["gateway"], allowance: null },
      { id: "starter", entitlements: ["billing", "gateway", "agentOsMachines"], allowance: 800 },
      { id: "team", entitlements: ["admin", "budgets", "billing", "gateway", "agentOsMachines"], allowance: 2200 },
      { id: "business", entitlements: ["whitelabel", "sso", "admin", "budgets", "billing", "gateway", "agentOsMachines"], allowance: 4000 },
    ]));
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(pushWorkerPlanCatalog(DEFAULT_RATION, {
      env: { MAXIMUS_OPERATOR_TOKEN: "operator-token" },
      baseURL: "https://accounts.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith("https://accounts.example/api/operator/plans", expect.objectContaining({ method: "PUT" }));
    await expect(pushWorkerPlanCatalog(DEFAULT_RATION, { env: {} })).resolves.toBe(false);
    expect(plansFromRation(profile).find((plan) => plan.id === "starter")?.hardCapUsd).toBe(16);
  });

  it("prices overage at the multiplier for the margin report only", () => {
    const ration = service();
    expect(ration.overageSell()).toBeNull();
    const enabled = structuredClone(DEFAULT_RATION);
    enabled.overageEnabled = true;
    expect(ration.saveProfile(enabled)).toBeNull();
    expect(ration.overageSell()?.["muse-spark-1.3"]?.outputPerMillion).toBeCloseTo(6.8, 6);
    const row: UsageRow = {
      at: "2026-11-10T00:00:00.000Z", botId: "b", botName: "Max", threadId: "t",
      instanceId: "muse", driverKind: "museCode", model: "muse-wonder-1.0",
      input: 1_000_000, output: 0, costUsd: null, trigger: { kind: "user" }, via: "bundled",
    };
    const summary = summarizeMargin([row], ration.overageSell(), LIST_PRICES);
    expect(summary.total.marginPct).toBeGreaterThan(0);
  });

  it("stores the pooled key without returning it", () => {
    const folder = mkdtempSync(join(tmpdir(), "maximus-ration-"));
    folders.push(folder);
    const ration = new RationService({ dataDir: folder });
    ration.setPoolKey("meta-secret-key-1234");
    expect(ration.view().pool).toEqual({ configured: true, last4: "1234" });
    expect(JSON.stringify(ration.view())).not.toContain("meta-secret");
    expect(ration.metaKey()).toBe("meta-secret-key-1234");
    const reloaded = new RationService({ dataDir: folder });
    expect(reloaded.metaKey()).toBe("meta-secret-key-1234");
    const raw = readFileSync(join(folder, "billing", "pool-key.json"), "utf8");
    expect(raw).toContain("meta-secret-key-1234");
  });

  it("keeps a rejected edit off the live profile", () => {
    const ration = service();
    const broken = structuredClone(DEFAULT_RATION);
    broken.hosted[0]!.includedCostUsd = 15;
    expect(ration.saveProfile(broken)).toMatch(/half/);
    expect(ration.profileNow().hosted[0]!.includedCostUsd).toBe(8);
  });

  it("spends admin credit for that email only and leaves other free wallets alone", () => {
    const ration = service();
    const now = new Date("2026-11-10T12:00:00Z");
    const granted = ration.grantAccount({ email: "Ada@example.com", creditUsd: 1, note: "paid cash" }, now);
    expect(granted.ok).toBe(true);
    expect(ration.chargeChat("local", "ada@example.com", "hello", now)).toBeNull();
    expect(ration.wallet("local").spentUsd).toBe(0);
    expect(ration.wallet("free:ada@example.com").spentUsd).toBe(0);
    const ada = ration.listGrants()[0]!;
    expect(ada.email).toBe("ada@example.com");
    expect(ada.spentUsd).toBeGreaterThan(0);
    expect(ada.note).toBe("paid cash");
    ration.chooseAccount("other@example.com", "free");
    expect(ration.chargeChat("local", "other@example.com", "hello", now)).toBeNull();
    expect(ration.wallet("local").spentUsd).toBe(0);
    expect(ration.wallet("free:other@example.com").spentUsd).toBeGreaterThan(0);
    expect(ration.listGrants()[0]!.spentUsd).toBe(ada.spentUsd);
    const again = ration.grantAccount({ email: "ada@example.com", tokens: 1_000_000 }, now);
    expect(again.ok && again.seat.creditUsd).toBeCloseTo(5.25, 6);
  });

  it("assigns an off-record plan without changing anyone else's wallet", () => {
    const ration = service();
    const now = new Date("2026-11-10T12:00:00Z");
    expect(ration.grantAccount({ email: "ada@example.com", plan: "starter" }, now).ok).toBe(true);
    expect(ration.accountChoice("ada@example.com")).toBe("muse");
    expect(ration.walletView("local", now, { email: "ada@example.com" })).toMatchObject({ tier: "starter", grantedUsd: 8 });
    expect(ration.wallet("local").tier).toBe("free");
    expect(ration.wallet("local").freeUsed).toBe(false);
    expect(ration.chargeChat("local", "ada@example.com", "hello", now)).toBeNull();
    expect(ration.wallet("local").spentUsd).toBe(0);
    expect(ration.listGrants()[0]!.spentUsd).toBeGreaterThan(0);
    expect(ration.grantAccount({ email: "ada@example.com", plan: "starter", renew: true }, now).ok).toBe(true);
    expect(ration.listGrants()[0]!.spentUsd).toBe(0);
    expect(ration.grantAccount({ email: "ada@example.com", plan: "byo" }, now).ok).toBe(true);
    expect(ration.accountChoice("ada@example.com")).toBe("byo");
    expect(ration.chargeChat("local", "ada@example.com", "hello", now)).toBeNull();
    expect(ration.wallet("local").tier).toBe("free");
    expect(ration.grantAccount({ email: "not-an-email", creditUsd: 1 }).ok).toBe(false);
    expect(ration.grantAccount({ email: "ada@example.com" }).ok).toBe(false);
  });
});
