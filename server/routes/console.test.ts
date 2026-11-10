import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import { ControlPlaneError, type ControlPlaneClient } from "../../electron/control-plane-client.mjs";
import { createConsolePublicRoutes, planCatalogView } from "./console.ts";

const TOKEN = `signed.${"t".repeat(40)}`;

function reqRes(options: {
  path?: string;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  bodyThrows?: boolean;
}) {
  const req = { url: options.url ?? options.path ?? "/", headers: options.headers ?? {} } as IncomingMessage;
  const res = { setHeader: () => undefined } as unknown as ServerResponse;
  const calls: { status: number; body: unknown }[] = [];
  const json = (_res: ServerResponse, status: number, body: unknown): void => {
    calls.push({ status, body });
  };
  const readBody = async (): Promise<unknown> => {
    if (options.bodyThrows) throw new Error("boom");
    return options.body ?? null;
  };
  return { req, res, calls, json, readBody };
}

function stubClient(impl: Record<string, (...args: never[]) => unknown> = {}) {
  return {
    requestOTP: vi.fn(async () => ({ email: "ada@example.com" })),
    verifyOTP: vi.fn(async () => ({ accountToken: TOKEN, user: { id: "u1", email: "ada@example.com" } })),
    authed: vi.fn(async () => ({ ok: true })),
    ...impl,
  } as unknown as ControlPlaneClient;
}

describe("console public routes", () => {
  it("declines non-console paths", async () => {
    const handle = createConsolePublicRoutes({ client: stubClient() });
    for (const path of ["/api/bots", "/api/console", "/api/console/other", "/"]) {
      const { req, res, calls, json, readBody } = reqRes({ path, method: "GET" });
      expect(await handle(req, res, path, "GET", json, readBody)).toBe(false);
      expect(calls).toEqual([]);
    }
  });

  it("starts and verifies email OTP", async () => {
    const client = stubClient();
    const handle = createConsolePublicRoutes({ client });
    const start = reqRes({ path: "/api/console/auth/otp/start", method: "POST", body: { email: "Ada@Example.com" } });
    expect(await handle(start.req, start.res, start.req.url!, "POST", start.json, start.readBody)).toBe(true);
    expect(start.calls).toEqual([{ status: 200, body: { ok: true, email: "ada@example.com" } }]);
    const verify = reqRes({ path: "/api/console/auth/otp/verify", method: "POST", body: { email: "ada@example.com", code: "12345678" } });
    expect(await handle(verify.req, verify.res, verify.req.url!, "POST", verify.json, verify.readBody)).toBe(true);
    expect(verify.calls[0]?.status).toBe(200);
    expect(verify.calls[0]?.body).toMatchObject({ token: TOKEN, user: { email: "ada@example.com" } });
  });

  it("rejects a bad email before touching the control plane", async () => {
    const client = stubClient();
    const handle = createConsolePublicRoutes({ client });
    const { req, res, calls, json, readBody } = reqRes({ path: "/api/console/auth/otp/start", method: "POST", body: { email: "nope" } });
    expect(await handle(req, res, req.url!, "POST", json, readBody)).toBe(true);
    expect(calls).toEqual([{ status: 400, body: { error: "Enter a valid email address.", code: "invalid_email" } }]);
    expect(client.requestOTP).not.toHaveBeenCalled();
  });

  it("forwards signup with the bearer token and keeps the 201", async () => {
    const authed = vi.fn(async () => ({ workspace: { id: "acme" } }));
    const handle = createConsolePublicRoutes({ client: stubClient({ authed }) });
    const { req, res, calls, json, readBody } = reqRes({
      path: "/api/console/workspaces",
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: { workspace: "acme", plan: "free" },
    });
    expect(await handle(req, res, req.url!, "POST", json, readBody)).toBe(true);
    expect(authed).toHaveBeenCalledWith("/api/auth/signup", { method: "POST", token: TOKEN, body: { workspace: "acme", plan: "free" } });
    expect(calls).toEqual([{ status: 201, body: { workspace: { id: "acme" } } }]);
  });

  it("requires the account token on workspace calls", async () => {
    const authed = vi.fn(async () => ({}));
    const handle = createConsolePublicRoutes({ client: stubClient({ authed }) });
    const { req, res, calls, json, readBody } = reqRes({ path: "/api/console/workspaces", method: "POST", body: { workspace: "acme" } });
    expect(await handle(req, res, req.url!, "POST", json, readBody)).toBe(true);
    expect(calls[0]?.status).toBe(401);
    expect(authed).not.toHaveBeenCalled();
  });

  it("maps control-plane failures to console errors", async () => {
    const authed = vi.fn(async () => {
      throw new ControlPlaneError("conflict", 409);
    });
    const handle = createConsolePublicRoutes({ client: stubClient({ authed }) });
    const { req, res, calls, json, readBody } = reqRes({
      path: "/api/console/workspaces",
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: { workspace: "acme" },
    });
    expect(await handle(req, res, req.url!, "POST", json, readBody)).toBe(true);
    expect(calls).toEqual([{ status: 409, body: { error: "That workspace name is taken.", code: "conflict" } }]);
  });

  it("routes invites, providers and admin reads to the matching worker paths", async () => {
    const authed = vi.fn(async (path: string) => ({ path }));
    const handle = createConsolePublicRoutes({ client: stubClient({ authed }) });
    const headers = { authorization: `Bearer ${TOKEN}` };
    const call = async (path: string, method: string, body?: unknown, url?: string) => {
      const r = reqRes({ path, method, headers, body, url });
      expect(await handle(r.req, r.res, path, method, r.json, r.readBody)).toBe(true);
      return r.calls;
    };
    await call("/api/console/invites/accept", "POST", { token: "x".repeat(43) });
    expect(authed).toHaveBeenLastCalledWith("/api/auth/invite/accept", expect.objectContaining({ method: "POST", token: TOKEN }));
    await call("/api/console/workspaces/acme/providers", "GET");
    expect(authed).toHaveBeenLastCalledWith("/api/workspaces/acme/providers", { token: TOKEN });
    await call("/api/console/workspaces/acme/providers/kimi", "PUT", { mode: "bundled", models: ["kimi-k3"] });
    expect(authed).toHaveBeenLastCalledWith("/api/workspaces/acme/providers/kimi", expect.objectContaining({ method: "PUT" }));
    await call("/api/console/admin/seats", "GET", undefined, "/api/console/admin/seats?workspace=acme");
    expect(authed).toHaveBeenLastCalledWith("/api/admin/seats", { token: TOKEN, query: { workspace: "acme" } });
    await call("/api/console/workspaces/acme/entitlements", "GET");
    expect(authed).toHaveBeenLastCalledWith("/api/workspaces/acme/entitlements", { token: TOKEN });
    await call("/api/console/workspaces/acme/spend", "GET");
    expect(authed).toHaveBeenLastCalledWith("/api/workspaces/acme/spend", { token: TOKEN });
    await call("/api/console/memberships", "GET");
    expect(authed).toHaveBeenLastCalledWith("/api/auth/memberships", { token: TOKEN });
    const spendPut = await call("/api/console/workspaces/acme/spend", "PUT", { spent: 1 });
    expect(spendPut[0]?.status).toBe(405);
    const badProvider = await call("/api/console/workspaces/acme/providers/nope", "PUT", { mode: "off" });
    expect(badProvider[0]?.status).toBe(404);
    const missingWorkspace = reqRes({ path: "/api/console/admin/seats", method: "GET", headers, url: "/api/console/admin/seats" });
    expect(await handle(missingWorkspace.req, missingWorkspace.res, "/api/console/admin/seats", "GET", missingWorkspace.json, missingWorkspace.readBody)).toBe(true);
    expect(missingWorkspace.calls[0]?.status).toBe(400);
  });

  it("routes store billing verify and status to the worker", async () => {
    const authed = vi.fn(async (path: string) => ({ path }));
    const handle = createConsolePublicRoutes({ client: stubClient({ authed }) });
    const headers = { authorization: `Bearer ${TOKEN}` };
    const verify = reqRes({ path: "/api/console/billing/store/verify", method: "POST", headers, body: { workspace: "acme", platform: "apple", receipt: "tx-1" } });
    expect(await handle(verify.req, verify.res, "/api/console/billing/store/verify", "POST", verify.json, verify.readBody)).toBe(true);
    expect(authed).toHaveBeenLastCalledWith("/api/billing/store/verify", expect.objectContaining({ method: "POST", token: TOKEN }));
    const status = reqRes({ path: "/api/console/billing/store/status", method: "GET", headers, url: "/api/console/billing/store/status?workspace=acme" });
    expect(await handle(status.req, status.res, "/api/console/billing/store/status", "GET", status.json, status.readBody)).toBe(true);
    expect(authed).toHaveBeenLastCalledWith("/api/billing/store/status", { token: TOKEN, query: { workspace: "acme" } });
    const missing = reqRes({ path: "/api/console/billing/store/status", method: "GET", headers, url: "/api/console/billing/store/status" });
    expect(await handle(missing.req, missing.res, "/api/console/billing/store/status", "GET", missing.json, missing.readBody)).toBe(true);
    expect(missing.calls[0]?.status).toBe(400);
  });

  it("answers 503 without a configured control plane", async () => {
    const handle = createConsolePublicRoutes({ env: {}, controlPlaneURL: "" });
    const { req, res, calls, json, readBody } = reqRes({ path: "/api/console/workspaces", method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: {} });
    expect(await handle(req, res, req.url!, "POST", json, readBody)).toBe(true);
    expect(calls[0]?.status).toBe(503);
  });

  it("serves the plan catalog publicly with free always first", () => {
    const views = planCatalogView(new Map([
      ["team", { id: "team", baseUsd: 20, allowanceUsd: 20, hardCapUsd: 100, entitlements: ["admin"] }],
    ]));
    expect(views.map((view) => view.id)).toEqual(["free", "team"]);
    expect(views[0]).toMatchObject({ baseUsd: 0, allowanceUsd: 0, entitlements: [] });
    expect(views[1]).toMatchObject({ name: "Team", baseUsd: 20, allowanceUsd: 20 });
  });

  it("starts provider sign-in only back to this server's sign-in page", async () => {
    const startSocial = vi.fn(async () => ({ url: "https://github.com/login/oauth/authorize?x=1" }));
    const handle = createConsolePublicRoutes({ client: stubClient({ startSocial }) });
    const ok = reqRes({
      path: "/api/console/auth/social",
      method: "POST",
      headers: { host: "127.0.0.1:5199" },
      body: { provider: "github", callbackURL: "http://127.0.0.1:5199/signin" },
    });
    expect(await handle(ok.req, ok.res, ok.req.url!, "POST", ok.json, ok.readBody)).toBe(true);
    expect(ok.calls[0]?.body).toEqual({ url: "https://github.com/login/oauth/authorize?x=1" });
    const foreign = reqRes({
      path: "/api/console/auth/social",
      method: "POST",
      headers: { host: "127.0.0.1:5199" },
      body: { provider: "github", callbackURL: "https://evil.example/signin" },
    });
    expect(await handle(foreign.req, foreign.res, foreign.req.url!, "POST", foreign.json, foreign.readBody)).toBe(true);
    expect(foreign.calls[0]?.status).toBe(400);
    expect(startSocial).toHaveBeenCalledTimes(1);
  });

  it("serves GET /api/console/plans without a token", async () => {
    const handle = createConsolePublicRoutes({ env: {}, controlPlaneURL: "", plans: new Map() });
    const { req, res, calls, json, readBody } = reqRes({ path: "/api/console/plans", method: "GET" });
    expect(await handle(req, res, req.url!, "GET", json, readBody)).toBe(true);
    expect(calls[0]?.status).toBe(200);
    const body = calls[0]?.body as { plans: { id: string }[] };
    expect(body.plans.map((plan) => plan.id)).toEqual(["free"]);
  });

  it("reflects an admin-edited Free plan in the public pricing view", () => {
    const plans = new Map([
      ["free", { id: "free", baseUsd: 5, allowanceUsd: 10, hardCapUsd: null, entitlements: ["gateway"] }],
    ]);
    const displays = new Map([
      ["free", { name: "Starter", blurb: "Start here.", features: ["One room"] }],
    ]);
    const views = planCatalogView(plans as never, displays as never);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ id: "free", name: "Starter", baseUsd: 5, allowanceUsd: 10, entitlements: ["gateway"] });
  });
});
