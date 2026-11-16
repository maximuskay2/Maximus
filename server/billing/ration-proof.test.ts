import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { KNOWN_ENTITLEMENTS } from "../enterprise.ts";
import { billingGatewayRoute } from "../routes/billing.ts";
import { resetSwitchboardCacheForTests } from "../switchboard.ts";
import type { BillingEvent } from "./events.ts";
import type { BundledPlan } from "./plans.ts";
import { debitUsd, DEFAULT_RATION, rateFor, rationProblems } from "./ration.ts";
import { RationService } from "./ration-service.ts";
import { BillingStore } from "./store.ts";

const TOKEN = `maximus_workspace_${"p".repeat(43)}`;
const BYO_TOKEN = `maximus_workspace_${"q".repeat(43)}`;
const POOL_KEY = "pool-secret-abcdef1234";
const USER_KEY = "user-personal-key-9999";
const NOW = Date.parse("2026-11-10T12:00:00.000Z");

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  resetSwitchboardCacheForTests();
});

interface ProofFixture {
  dataDir: string;
  ration: RationService;
  store: BillingStore;
  plans: Map<string, BundledPlan>;
  env: NodeJS.ProcessEnv;
}

function fixture(): ProofFixture {
  const dataDir = mkdtempSync(join(tmpdir(), "maximus-ration-proof-"));
  folders.push(dataDir);
  const ration = new RationService({ dataDir });
  ration.setPoolKey(POOL_KEY);
  const plans = new Map<string, BundledPlan>([
    ["starter", { id: "starter", baseUsd: 19, allowanceUsd: 8, hardCapUsd: 8, entitlements: ["billing", "gateway"] }],
    ["byo", { id: "byo", baseUsd: 9, allowanceUsd: 0, hardCapUsd: 0, entitlements: ["billing"] }],
  ]);
  const store = new BillingStore({ dataDir, plans, knownEntitlements: KNOWN_ENTITLEMENTS, now: () => NOW });
  const env: NodeJS.ProcessEnv = {
    MAXIMUS_GATEWAY_TOKENS: JSON.stringify({ acme: TOKEN, "byo-acme": BYO_TOKEN }),
    MAXIMUS_WORKSPACE_PROVIDERS: JSON.stringify({
      muse: { mode: "bundled", models: ["muse-spark-1.3", "muse-spark-1.3-contributor", "muse-wonder-1.0"] },
    }),
  };
  return { dataDir, ration, store, plans, env };
}

function paidEvent(workspace: string, plan: string, entitlements: string[], eventId: string): BillingEvent {
  return {
    event_id: eventId,
    type: "billing.checkout_completed",
    created_at: new Date(NOW).toISOString(),
    provider: "stripe",
    livemode: false,
    workspace_id: workspace,
    customer_id: "cus_proof",
    plan,
    entitlements,
    allowance: null,
  };
}

interface UpstreamCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

interface TurnResult {
  handled: boolean;
  status: number;
  body: unknown;
  upstream: UpstreamCall[];
}

async function gatewayTurn(
  fix: ProofFixture,
  options: {
    workspace?: string;
    model?: string;
    token?: string;
    headers?: Record<string, string>;
    usage?: Record<string, unknown>;
    upstreamStatus?: number;
    rawBody?: string;
  } = {},
): Promise<TurnResult> {
  const upstream: UpstreamCall[] = [];
  const fetchImpl = (async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    upstream.push({ url, headers: { ...init?.headers }, body: init?.body ?? "" });
    return new Response(JSON.stringify({ usage: options.usage ?? { prompt_tokens: 100, completion_tokens: 40 } }), {
      status: options.upstreamStatus ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const payload = options.rawBody ?? JSON.stringify({ model: options.model ?? "muse-spark-1.3" });
  const req = Object.assign(Readable.from([payload]), {
    headers: { authorization: `Bearer ${options.token ?? TOKEN}`, ...options.headers },
  }) as unknown as IncomingMessage;
  let status = 0;
  let body: unknown = null;
  const res = {
    writeHead: (code: number) => {
      status = code;
    },
    end: (payload?: string) => {
      body = payload;
    },
  } as unknown as ServerResponse;
  const json = (_res: ServerResponse, code: number, payload: unknown) => {
    status = code;
    body = payload;
  };
  const handled = await billingGatewayRoute(req, res, `/api/gateway/${options.workspace ?? "acme"}/muse/v1/responses`, "POST", json, {
    dataDir: fix.dataDir,
    store: fix.store,
    plans: fix.plans,
    knownEntitlements: KNOWN_ENTITLEMENTS,
    env: fix.env,
    now: () => NOW,
    ration: fix.ration,
    fetchImpl,
  });
  return { handled, status, body, upstream };
}

describe("ration proof on an isolated workspace", () => {
  it("grants the free amount from the saved profile", () => {
    const fix = fixture();
    expect(rationProblems(DEFAULT_RATION)).toBeNull();
    const wallet = fix.ration.ensureFree("acme", new Date(NOW), { email: "ada@example.com", installId: "install-1" });
    expect(wallet.grantedUsd).toBe(fix.ration.profileNow().freeGrantUsd);
    expect(wallet.grantedUsd).toBe(0.012);
    expect(wallet.workspace).toBe("free:ada@example.com");
    expect(fix.ration.walletView("acme", new Date(NOW), { email: "ada@example.com" }).leftUsd).toBe(0.012);
    expect(fix.ration.ensureFree("acme", new Date(NOW), { email: "bob@example.com" }).grantedUsd).toBe(0.012);
  });

  it("debits one bundled turn by the input, cache, and output formula", async () => {
    const fix = fixture();
    fix.store.apply(paidEvent("acme", "starter", ["billing", "gateway"], "evt-proof-1"));
    fix.ration.grantPaid("acme", "starter", "stripe:evt-proof-1", new Date(NOW));
    const rate = rateFor(fix.ration.profileNow(), "muse-spark-1.3")!;
    const expected = debitUsd({ freshInput: 8000, cachedInput: 12000, output: 800 }, rate);
    const turn = await gatewayTurn(fix, {
      usage: { prompt_tokens: 20000, completion_tokens: 800, prompt_tokens_details: { cached_tokens: 12000 } },
    });
    expect(turn.handled).toBe(true);
    expect(turn.status).toBe(200);
    expect(turn.upstream).toHaveLength(1);
    expect(fix.ration.wallet("acme").spentUsd).toBeCloseTo(expected, 6);
    expect(expected).toBeCloseTo(0.0152, 6);
  });

  it("keeps the pool key off bring-your-own turns and debits nothing", async () => {
    const fix = fixture();
    fix.store.apply(paidEvent("byo-acme", "byo", ["billing"], "evt-proof-byo"));
    fix.ration.grantPaid("byo-acme", "byo", "stripe:evt-proof-byo", new Date(NOW));
    const turn = await gatewayTurn(fix, { workspace: "byo-acme", token: BYO_TOKEN });
    expect(turn.handled).toBe(true);
    expect(turn.status).toBe(403);
    expect(turn.upstream).toHaveLength(0);
    expect(fix.ration.debit("byo-acme", "muse-spark-1.3", { freshInput: 8000, cachedInput: 0, output: 800 })).toBeNull();
    expect(fix.ration.wallet("byo-acme").spentUsd).toBe(0);
    expect(fix.ration.admitByo("byo-acme", new Date(NOW))).toBeNull();
  });

  it("forwards bundled turns with the pool key and refuses smuggled user credentials", async () => {
    const fix = fixture();
    fix.store.apply(paidEvent("acme", "starter", ["billing", "gateway"], "evt-proof-2"));
    fix.ration.grantPaid("acme", "starter", "stripe:evt-proof-2", new Date(NOW));
    const turn = await gatewayTurn(fix);
    expect(turn.status).toBe(200);
    expect(turn.upstream).toHaveLength(1);
    expect(turn.upstream[0]?.headers.authorization).toBe(`Bearer ${POOL_KEY}`);
    expect(JSON.stringify(turn.upstream[0])).not.toContain(USER_KEY);
    const smuggled = await gatewayTurn(fix, { headers: { "x-api-key": USER_KEY } });
    expect(smuggled.status).toBe(400);
    expect(smuggled.upstream).toHaveLength(0);
  });

  it("grants a paid invoice once even when it is delivered twice", async () => {
    const fix = fixture();
    const event = paidEvent("acme", "starter", ["billing", "gateway"], "evt-proof-replay");
    expect(fix.store.apply(event).outcome).toBe("applied");
    fix.ration.grantPaid("acme", "starter", "stripe:evt-proof-replay", new Date(NOW));
    const turn = await gatewayTurn(fix, { usage: { prompt_tokens: 100, completion_tokens: 40 } });
    expect(turn.status).toBe(200);
    const spent = fix.ration.wallet("acme").spentUsd;
    expect(spent).toBeGreaterThan(0);
    expect(fix.store.apply(event).outcome).toBe("duplicate");
    const replayed = fix.ration.grantPaid("acme", "starter", "stripe:evt-proof-replay", new Date(NOW));
    expect(replayed?.grantedUsd).toBe(8);
    expect(fix.ration.wallet("acme").spentUsd).toBe(spent);
  });

  it("refuses the turn at zero with spend_cap while Your model still runs", async () => {
    const fix = fixture();
    const tiny = structuredClone(DEFAULT_RATION);
    tiny.freeGrantUsd = 0.0001;
    expect(fix.ration.saveProfile(tiny)).toBeNull();
    fix.store.apply(paidEvent("acme", "starter", ["billing", "gateway"], "evt-proof-zero"));
    fix.ration.ensureFree("acme", new Date(NOW));
    const refused = await gatewayTurn(fix, {
      model: "muse-spark-1.3-contributor",
      rawBody: JSON.stringify({ model: "muse-spark-1.3-contributor", text: "x".repeat(50_000) }),
    });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "spend_cap" });
    expect(refused.upstream).toHaveLength(0);

    fix.store.apply(paidEvent("byo-acme", "byo", ["billing"], "evt-proof-zero-byo"));
    fix.ration.grantPaid("byo-acme", "byo", "stripe:evt-proof-zero-byo", new Date(NOW));
    expect(fix.ration.admitByo("byo-acme", new Date(NOW))).toBeNull();
    expect(fix.ration.wallet("byo-acme").spentUsd).toBe(0);
  });

  it("refuses a Wonder request on the free grant before the provider is called", async () => {
    const fix = fixture();
    fix.store.apply(paidEvent("acme", "starter", ["billing", "gateway"], "evt-proof-wonder"));
    fix.ration.ensureFree("acme", new Date(NOW));
    const refused = await gatewayTurn(fix, { model: "muse-wonder-1.0" });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "model_locked" });
    expect(refused.upstream).toHaveLength(0);
    expect(fix.ration.wallet("acme").spentUsd).toBe(0);
  });

  it("keeps included provider cost at or under half the seat price with overage off", () => {
    const fix = fixture();
    const profile = fix.ration.profileNow();
    expect(profile.overageEnabled).toBe(false);
    for (const tier of profile.hosted) {
      expect(tier.includedCostUsd).toBeLessThanOrEqual(tier.priceUsd * 0.5);
      expect(tier.hardCapUsd).toBe(tier.includedCostUsd);
    }
    expect(profile.byoPriceUsd).toBeLessThanOrEqual(
      (profile.hosted.find((tier) => tier.id === "starter")?.priceUsd ?? 0) - 8,
    );
  });
});
