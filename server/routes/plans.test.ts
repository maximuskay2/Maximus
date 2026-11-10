import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { BundledPlan } from "../billing/plans.ts";
import { PlanStore, resolveCatalog, type PlanDisplayView, type StoredPlan } from "../billing/plan-store.ts";
import { json, readBody } from "../harness/http.ts";
import { createPlanRoutes } from "./plans.ts";
import { dispatchRoutes } from "./table.ts";

const KNOWN = ["whitelabel", "sso", "admin", "budgets", "billing", "gateway"];
const servers: Server[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const TEAM: StoredPlan = {
  id: "team",
  baseUsd: 20,
  allowanceUsd: 20,
  hardCapUsd: null,
  entitlements: ["admin", "budgets", "billing", "gateway"],
  display: { name: "Team", blurb: "For teams.", features: ["Shared rooms"] },
};

async function serve(options: { scopes?: string[]; seed?: Map<string, BundledPlan> } = {}) {
  const folder = mkdtempSync(join(tmpdir(), "maximus-plan-routes-"));
  folders.push(folder);
  const store = new PlanStore({ dataDir: folder });
  const plans = new Map<string, BundledPlan>(options.seed ?? []);
  const displays = new Map<string, PlanDisplayView>();
  const refresh = (): void => {
    const effective = resolveCatalog(options.seed ?? new Map(), store.list());
    plans.clear();
    displays.clear();
    for (const [id, plan] of effective.plans) plans.set(id, plan);
    for (const [id, display] of effective.displays) displays.set(id, display);
  };
  refresh();
  const routes = [createPlanRoutes({
    knownEntitlements: KNOWN,
    catalog: () => ({ plans, displays }),
    upsert: (plan) => {
      store.saveAll([...store.list().filter((row) => row.id !== plan.id), plan]);
      refresh();
    },
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, {
      req, res, url, path: url.pathname, method: req.method ?? "GET",
      auth: { kind: "session", scopes: options.scopes ?? ["admin", "client"] } as never, json, readBody,
    });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${base}${path}`, init);
    return [response.status, await response.json()] as const;
  };
  return { base, call, store };
}

describe("/api/admin/plans", () => {
  it("lists free plus the live catalog, and refuses non-admins", async () => {
    const { call } = await serve();
    const [status, body] = await call("/api/admin/plans") as [number, { plans: { id: string; editable: boolean }[] }];
    expect(status).toBe(200);
    expect(body.plans).toEqual([{ id: "free", name: "Free", blurb: "", features: [], baseUsd: 0, allowanceUsd: 0, hardCapUsd: null, entitlements: [], source: "builtin", editable: true }]);
    const member = await serve({ scopes: ["client"] });
    expect((await member.call("/api/admin/plans"))[0]).toBe(403);
  });

  it("creates, edits, and rejects bad plans without touching the seed", async () => {
    const seed = new Map<string, BundledPlan>([["legacy", { id: "legacy", baseUsd: 5, allowanceUsd: 5, hardCapUsd: null, entitlements: [] }]]);
    const { call, store } = await serve({ seed });
    const post = (body: unknown) => call("/api/admin/plans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post(TEAM))[0]).toBe(201);
    expect((await post(TEAM))[1]).toMatchObject({ error: expect.stringContaining("already exists") });
    expect((await post({ ...TEAM, id: "free" }))[0]).toBe(201);
    expect((await post({ ...TEAM, id: "bad", entitlements: ["nope"] }))[1]).toMatchObject({ error: expect.stringContaining("unknown entitlement") });
    expect((await post({ ...TEAM, id: "capped", hardCapUsd: 5 }))[0]).toBe(400);
    const put = (id: string, body: unknown) => call(`/api/admin/plans/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await put("missing", TEAM))[0]).toBe(404);
    expect((await put("free", { ...TEAM, id: "free" }))[0]).toBe(200);
    const [edited, view] = await put("team", { ...TEAM, baseUsd: 25 }) as [number, { plan: { baseUsd: number; source: string } }];
    expect(edited).toBe(200);
    expect(view.plan).toMatchObject({ baseUsd: 25, source: "stored" });
    expect(store.list().map((row) => row.id)).toEqual(["free", "team"]);
    const [, listed] = await call("/api/admin/plans") as [number, { plans: { id: string; source: string }[] }];
    expect(listed.plans.map((row) => [row.id, row.source])).toEqual([["free", "stored"], ["legacy", "env"], ["team", "stored"]]);
  });
});
