import { mkdtempSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { KNOWN_ENTITLEMENTS } from "../enterprise.ts";
import { BillingStore } from "../billing/store.ts";
import type { BundledPlan } from "../billing/plans.ts";
import type { BillingEvent } from "../billing/events.ts";
import type { RequestAuth } from "../request-auth.ts";
import { flushUsageLedger, readUsage } from "../usage-ledger.ts";
import { billingGatewayRoute, billingWebhookRoute, createBillingRoutes } from "./billing.ts";
import { PASS, type RouteContext } from "./table.ts";

const PLANS = new Map<string, BundledPlan>([
  ["maximus-pro", { id: "maximus-pro", baseUsd: 49, allowanceUsd: 200, hardCapUsd: 500, entitlements: ["billing", "budgets", "gateway"] }],
]);

const NOW = Date.parse("2026-11-07T12:00:00.000Z");

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "billing-routes-"));
  const store = new BillingStore({ dataDir, plans: PLANS, knownEntitlements: KNOWN_ENTITLEMENTS, now: () => NOW });
  return { dataDir, store };
}

const authFor = (admin: boolean): RequestAuth =>
  ({ kind: "session", scopes: admin ? ["admin", "client"] : ["client"] }) as unknown as RequestAuth;

function ctxFor(
  path: string,
  method: string,
  body: unknown,
  admin = true,
  auth?: RequestAuth,
  headers: Record<string, string> = {},
): { ctx: RouteContext; sent: Array<{ status: number; body: unknown }> } {
  const sent: Array<{ status: number; body: unknown }> = [];
  const ctx = {
    req: { headers } as IncomingMessage,
    res: { setHeader: () => {} } as unknown as ServerResponse,
    url: new URL(path, "http://localhost"),
    path,
    method,
    auth: auth ?? authFor(admin),
    json: ((_res: ServerResponse, status: number, b: unknown) => {
      sent.push({ status, body: b });
    }) as RouteContext["json"],
    readBody: (async () => body) as RouteContext["readBody"],
  };
  return { ctx, sent };
}

describe("billing routes", () => {
  it("starts checkout for admins with the catalog plan and price ref", async () => {
    const { dataDir, store } = setup();
    const seen: { url: string; init: { body?: string } }[] = [];
    const fetchImpl = (async (url: string, init: { body?: string }): Promise<Response> => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ id: "cs_x", url: "https://checkout.stripe.com/pay/cs_x", livemode: false }), { status: 200 });
    }) as typeof fetch;
    const handler = createBillingRoutes({
      dataDir,
      store,
      plans: PLANS,
      secrets: { stripeSecretKey: "sk_test_fixture" },
      fetchImpl,
      env: { MAXIMUS_STRIPE_PRICES: JSON.stringify({ "maximus-pro": "price_fixture" }), MAXIMUS_ADMIN_WORKSPACE: "acme" },
      now: () => NOW,
    });
    const { ctx, sent } = ctxFor("/api/billing/checkout", "POST", {
      provider: "stripe",
      plan: "maximus-pro",
      workspace: "acme",
      successUrl: "https://acme.example/done",
      cancelUrl: "https://acme.example/cancel",
    });
    await handler(ctx);
    expect(sent[0]?.status).toBe(200);
    expect(sent[0]?.body).toMatchObject({ checkout: { provider: "stripe", sessionId: "cs_x" } });
    expect(new URLSearchParams(seen[0]?.init.body ?? "").get("subscription_data[metadata][entitlements]")).toBe("[\"billing\",\"budgets\",\"gateway\"]");
  });

  it("charges Paystack in kobo for a signed-in person in Nigeria", async () => {
    const { dataDir, store } = setup();
    const seen: { body?: string }[] = [];
    const fetchImpl = (async (_url: string, init: { body?: string }): Promise<Response> => {
      seen.push({ body: init.body });
      return new Response(JSON.stringify({ status: true, data: { authorization_url: "https://checkout.paystack.com/ref", reference: "ref_ng" } }), { status: 200 });
    }) as typeof fetch;
    const handler = createBillingRoutes({
      dataDir,
      store,
      plans: PLANS,
      secrets: { paystackSecretKey: "sk_test_fixture" },
      payments: () => ({ paystackEnabled: true, ngnPerUsd: 1600 }),
      fetchImpl,
      env: { MAXIMUS_ADMIN_WORKSPACE: "acme" },
      now: () => NOW,
    });
    const { ctx, sent } = ctxFor("/api/billing/checkout", "POST", {
      provider: "paystack",
      plan: "maximus-pro",
      workspace: "acme",
      customerEmail: "ada@example.test",
      successUrl: "https://acme.example/done",
      cancelUrl: "https://acme.example/cancel",
      timeZone: "Africa/Lagos",
    }, false, undefined, { "cf-ipcountry": "NG" });
    await handler(ctx);
    expect(sent[0]?.status).toBe(200);
    const body = JSON.parse(seen[0]?.body ?? "{}") as { amount?: number; plan?: string };
    expect(body.amount).toBe(49 * 1600 * 100);
    expect(body.plan).toBeUndefined();
  });

  it("refuses checkout for a service shell, unknown plans and unpriced providers", async () => {
    const { dataDir, store } = setup();
    const handler = createBillingRoutes({ dataDir, store, plans: PLANS, env: { MAXIMUS_ADMIN_WORKSPACE: "acme" }, now: () => NOW });
    const body = { provider: "stripe", plan: "maximus-pro", workspace: "acme", successUrl: "https://a.example/d", cancelUrl: "https://a.example/c" };
    const shell = { kind: "loopback", scopes: ["client"], trust: "service" } as unknown as RequestAuth;
    const guest = ctxFor("/api/billing/checkout", "POST", body, false, shell);
    await handler(guest.ctx);
    expect(guest.sent[0]?.status).toBe(403);
    const unknown = ctxFor("/api/billing/checkout", "POST", { ...body, plan: "nope" });
    await handler(unknown.ctx);
    expect(unknown.sent[0]?.status).toBe(400);
    const unpriced = ctxFor("/api/billing/checkout", "POST", body);
    await handler(unpriced.ctx);
    expect(unpriced.sent[0]?.status).toBe(503);
  });

  it("reports status with budget burn-down and dunning banner", async () => {
    const { dataDir, store } = setup();
    store.apply({
      event_id: "evt_1", type: "billing.payment_failed", created_at: new Date(NOW).toISOString(), provider: "stripe",
      livemode: false, workspace_id: "acme", customer_id: "cus_1", plan: "maximus-pro",
      entitlements: ["billing", "budgets", "gateway"], allowance: 20000,
    } satisfies BillingEvent);
    const handler = createBillingRoutes({
      dataDir,
      store,
      plans: PLANS,
      knownEntitlements: KNOWN_ENTITLEMENTS,
      prices: () => ({ default: { inputPerMillion: 2, outputPerMillion: 10 } }),
      env: { MAXIMUS_ADMIN_WORKSPACE: "acme" },
      now: () => NOW,
    });
    const { ctx, sent } = ctxFor("/api/billing/status", "GET", {});
    await handler(ctx);
    expect(sent[0]?.status).toBe(200);
    const billing = ((sent[0]?.body ?? {}) as { billing?: Record<string, unknown> }).billing ?? {};
    expect(billing).toMatchObject({ workspace: "acme", plan: "maximus-pro", status: "grace" });
    expect(billing.granted).toEqual(["billing", "budgets", "gateway"]);
    expect(billing.budget).toMatchObject({ allowanceUsd: 200, spentUsd: 0, hardCapUsd: 500 });
    expect(billing.banner).toMatchObject({ kind: "grace" });
    const guest = ctxFor("/api/billing/status", "GET", {}, false);
    await handler(guest.ctx);
    expect(guest.sent[0]?.status).toBe(403);
    const other = ctxFor("/api/usage", "GET", {});
    expect(await handler(other.ctx)).toBe(PASS);
  });

  it("declines non-webhook paths pre-auth", async () => {
    const { dataDir, store } = setup();
    const json = (() => {}) as (res: ServerResponse, status: number, body: unknown) => void;
    expect(await billingWebhookRoute({} as IncomingMessage, {} as ServerResponse, "/api/usage", json, { dataDir, store })).toBe(false);
  });
});

const GATEWAY_TOKEN = `maximus_workspace_${"g".repeat(43)}`;

function streamReq(headers: Record<string, string>, body: string): IncomingMessage {
  const stream = Readable.from(body ? [body] : []);
  (stream as unknown as { headers: Record<string, string> }).headers = headers;
  return stream as IncomingMessage;
}

function captureRes(): { res: ServerResponse; done: Promise<{ status: number; body: string }> } {
  let resolve: (value: { status: number; body: string }) => void = () => {};
  const done = new Promise<{ status: number; body: string }>((ok) => { resolve = ok; });
  let status = 200;
  const res = {
    setHeader: () => {},
    writeHead: (code: number) => { status = code; },
    end: (body?: string) => { resolve({ status, body: body ?? "" }); },
  } as unknown as ServerResponse;
  return { res, done };
}

const grantGateway = (store: BillingStore): void => {
  store.apply({
    event_id: "evt_gateway", type: "billing.checkout_completed", created_at: new Date(NOW).toISOString(), provider: "stripe",
    livemode: false, workspace_id: "acme", customer_id: "cus_1", plan: "maximus-pro",
    entitlements: ["gateway"], allowance: 20000,
  } satisfies BillingEvent);
};

describe("managed gateway route", () => {
  const gatewayEnv = {
    MAXIMUS_WORKSPACE_PROVIDERS: JSON.stringify({ kimi: { mode: "bundled", models: ["kimi-k3.1-pro"] } }),
  };

  it("serves an entitled bundled turn end to end and meters it", async () => {
    const { dataDir, store } = setup();
    grantGateway(store);
    const upstream: Array<{ url: string; init: { headers?: Record<string, string> } }> = [];
    const fetchImpl = (async (url: string, init: { headers?: Record<string, string> }): Promise<Response> => {
      upstream.push({ url, init });
      return new Response(JSON.stringify({ usage: { prompt_tokens: 1000, completion_tokens: 500 } }), { status: 200 });
    }) as typeof fetch;
    const { res, done } = captureRes();
    const json = (() => { throw new Error("gateway answers with the upstream body, not json()"); }) as (res: ServerResponse, status: number, body: unknown) => void;
    const handled = await billingGatewayRoute(
      streamReq({ authorization: `Bearer ${GATEWAY_TOKEN}` }, JSON.stringify({ model: "kimi-k3.1-pro" })),
      res,
      "/api/gateway/acme/kimi/v1/chat/completions",
      "POST",
      json,
      {
        dataDir,
        store,
        plans: PLANS,
        knownEntitlements: KNOWN_ENTITLEMENTS,
        prices: () => ({ default: { inputPerMillion: 2, outputPerMillion: 10 } }),
        tokens: { workspaceFor: (token) => token === GATEWAY_TOKEN ? "acme" : null },
        keys: () => "our-kimi-key",
        fetchImpl,
        env: gatewayEnv,
        now: () => NOW,
      },
    );
    expect(handled).toBe(true);
    const answer = await done;
    expect(answer.status).toBe(200);
    expect(upstream).toHaveLength(1);
    expect(upstream[0]?.url).toBe("https://api.moonshot.ai/v1/v1/chat/completions");
    expect(upstream[0]?.init.headers?.authorization).toBe("Bearer our-kimi-key");
    await flushUsageLedger(dataDir);
    const rows = readUsage(dataDir, { from: new Date("2020-01-01"), to: new Date("2030-01-01") });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ via: "bundled", model: "kimi-k3.1-pro", input: 1000, output: 500 });
  });

  it("refuses without the gateway entitlement, with a bad token, or for unassigned models", async () => {
    const { dataDir, store } = setup();
    const answers: Array<{ status: number; body: unknown }> = [];
    const json = ((_res: ServerResponse, status: number, body: unknown) => { answers.push({ status, body }); }) as (res: ServerResponse, status: number, body: unknown) => void;
    const deps = {
      dataDir,
      store,
      plans: PLANS,
      knownEntitlements: KNOWN_ENTITLEMENTS,
      tokens: { workspaceFor: (token: string) => token === GATEWAY_TOKEN ? "acme" : null },
      keys: () => "our-kimi-key",
      env: gatewayEnv,
      now: () => NOW,
    };
    const { res } = captureRes();
    expect(await billingGatewayRoute(streamReq({ authorization: `Bearer ${GATEWAY_TOKEN}` }, "{}"), res, "/api/gateway/acme/kimi/x", "POST", json, deps)).toBe(true);
    grantGateway(store);
    const { res: res2 } = captureRes();
    expect(await billingGatewayRoute(streamReq({ authorization: "Bearer wrong" }, "{}"), res2, "/api/gateway/acme/kimi/x", "POST", json, deps)).toBe(true);
    const { res: res3, done } = captureRes();
    expect(await billingGatewayRoute(
      streamReq({ authorization: `Bearer ${GATEWAY_TOKEN}` }, JSON.stringify({ model: "not-assigned" })), res3,
      "/api/gateway/acme/kimi/v1/chat/completions", "POST", json, deps,
    )).toBe(true);
    const refused = await done;
    expect(answers[0]?.status).toBe(403);
    expect(answers[1]?.status).toBe(401);
    expect(refused.status).toBe(403);
    expect(refused.body).toContain("not assigned to this workspace");
    expect(await billingGatewayRoute(streamReq({}, ""), res, "/api/usage", "GET", json, deps)).toBe(false);
  });
});
