// Hosted routes: entitlement view (admin/member narrowing), routing view and
// contract-mismatch refusal. The control plane is a stub fetch.
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import { EntitlementSync } from "../entitlement-sync.ts";
import { MAXIMUS_CONTRACT_MISMATCH } from "../maximus-contract.ts";
import type { RequestAuth } from "../request-auth.ts";
import { resetSwitchboardCacheForTests } from "../switchboard.ts";
import { createHostedRoutes } from "./hosted.ts";
import { PASS, type RouteContext } from "./table.ts";

function stubFetch(entitlements: unknown, providers: unknown): typeof fetch {
  return (async (url: unknown) => {
    const path = new URL(String(url)).pathname;
    const body = path.endsWith("/entitlements") ? entitlements : providers;
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json", "x-maximus-contract-version": "1" },
    });
  }) as typeof fetch;
}

const ENTITLEMENTS = {
  entitlements: {
    workspace: "acme",
    plan: "business",
    entitlements: ["admin", "gateway"],
    allowance: 500,
    status: "active",
    graceEndsAt: null,
  },
};

const PROVIDERS = {
  workspace: "acme",
  providers: {
    kimi: { mode: "bundled", models: ["kimi-k3.1-pro"] },
    grok: { mode: "off" },
  },
};

async function synced(): Promise<EntitlementSync> {
  resetSwitchboardCacheForTests();
  const sync = new EntitlementSync({
    adminOrigin: "https://admin.example.test",
    workspace: "acme",
    fetchImpl: stubFetch(ENTITLEMENTS, PROVIDERS),
  });
  await sync.sync();
  return sync;
}

async function get(
  path: string,
  options: { sync: EntitlementSync | null; admin?: boolean; contract?: string } = { sync: null },
) {
  const handler = createHostedRoutes({ sync: () => options.sync });
  const sent: Array<{ status: number; body: unknown; headers: Record<string, string> }> = [];
  const headers: Record<string, string> = {};
  const auth = { kind: "session", scopes: options.admin === false ? ["client"] : ["admin", "client"] } as unknown as RequestAuth;
  const out = await handler({
    req: {
      headers: options.contract === undefined ? {} : { "x-maximus-contract-version": options.contract },
    } as unknown as IncomingMessage,
    res: { setHeader: (name: string, value: string) => { headers[name] = value; } } as unknown as ServerResponse,
    url: new URL(`http://localhost${path}`),
    path,
    method: "GET",
    auth,
    json: ((_res: ServerResponse, status: number, body: unknown) => {
      sent.push({ status, body, headers: { ...headers } });
    }) as RouteContext["json"],
    readBody: (async () => undefined) as RouteContext["readBody"],
  });
  return { out, sent, headers };
}

describe("hosted routes", () => {
  it("passes other paths and 503s without a sync client", async () => {
    const { out } = await get("/api/bots", { sync: null });
    expect(out).toBe(PASS);
    const missing = await get("/api/hosted/entitlements", { sync: null });
    expect(missing.sent[0]?.status).toBe(503);
  });

  it("refuses a contract mismatch with 409, never a silent downgrade", async () => {
    const sync = await synced();
    const response = await get("/api/hosted/entitlements", { sync, contract: "2" });
    expect(response.sent[0]?.status).toBe(409);
    expect(response.sent[0]?.body).toEqual({
      error: expect.stringContaining("incompatible"),
      code: MAXIMUS_CONTRACT_MISMATCH,
    });
  });

  it("shows the full entitlement view to admins and a narrowed view to members", async () => {
    const sync = await synced();
    const admin = await get("/api/hosted/entitlements", { sync });
    expect(admin.sent[0]?.status).toBe(200);
    expect(admin.sent[0]?.body).toMatchObject({
      entitlements: { workspace: "acme", plan: "business", granted: ["admin", "gateway"], allowance: 500, status: "active" },
    });
    expect(admin.headers["x-maximus-contract-version"]).toBe("1");
    const member = await get("/api/hosted/entitlements", { sync, admin: false });
    expect(member.sent[0]?.body).toEqual({
      entitlements: { workspace: "acme", granted: ["admin", "gateway"], banner: null, offline: false },
    });
  });

  it("shows the BYO-vs-bundled routing view from the synced policy", async () => {
    const sync = await synced();
    const response = await get("/api/hosted/routing", { sync });
    expect(response.sent[0]?.status).toBe(200);
    expect(response.sent[0]?.body).toMatchObject({
      routing: {
        workspace: "acme",
        bundledEntitled: true,
        providers: {
          kimi: { allowed: true, via: "bundled", models: ["kimi-k3.1-pro"] },
          grok: { allowed: false, via: "off" },
          claude: { allowed: true, via: "byo" },
        },
      },
    });
  });
});
