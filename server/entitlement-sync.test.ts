// Entitlement sync: contract mismatch, outage/offline, grace degradation,
// cache round-trip and startup log. The control plane is a stub fetch;
// fixtures only, never live data.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ContractMismatchError, EntitlementSync } from "./entitlement-sync.ts";
import { MAXIMUS_CONTRACT_MISMATCH } from "./maximus-contract.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const WORKSPACE = "acme";

function entitlementsBody(overrides: Record<string, unknown> = {}) {
  return {
    entitlements: {
      workspace: WORKSPACE,
      plan: "business",
      entitlements: ["admin", "gateway", "unshipped-future"],
      allowance: 1000,
      status: "active",
      graceEndsAt: null,
      ...overrides,
    },
  };
}

const providersBody = {
  workspace: WORKSPACE,
  providers: {
    kimi: { mode: "bundled", models: ["kimi-k3.1-pro"] },
    grok: { mode: "off" },
  },
};

function stubFetch(handler: (path: string) => Response): typeof fetch {
  return (async (url: unknown) => handler(new URL(String(url)).pathname)) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200, contractVersion: string | null = "1"): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (contractVersion !== null) headers.set("x-maximus-contract-version", contractVersion);
  return new Response(JSON.stringify(body), { status, headers });
}

describe("entitlement sync", () => {
  it("syncs entitlements + providers and grants known ids only", async () => {
    const sync = new EntitlementSync({
      adminOrigin: "https://admin.example.test",
      workspace: WORKSPACE,
      fetchImpl: stubFetch((path) => path.endsWith("/entitlements")
        ? jsonResponse(entitlementsBody())
        : jsonResponse(providersBody)),
    });
    const view = await sync.sync();
    expect(view).toMatchObject({
      workspace: WORKSPACE,
      plan: "business",
      granted: ["admin", "gateway"],
      allowance: 1000,
      status: "active",
      offline: false,
    });
    expect(view.carried).toContain("unshipped-future");
    expect(view.banner).toBeNull();
    expect(sync.startupLog()).toBe("hosted entitlements for acme: admin, gateway (business)");
    const policy = sync.workspacePolicy();
    expect(policy?.providers.kimi).toEqual({ mode: "bundled", models: ["kimi-k3.1-pro"] });
    expect(policy?.providers.grok).toEqual({ mode: "off", models: [] });
  });

  it("throws ContractMismatchError on a wire mismatch, never a silent downgrade", async () => {
    const sync = new EntitlementSync({
      adminOrigin: "https://admin.example.test",
      workspace: WORKSPACE,
      fetchImpl: stubFetch((path) => path.endsWith("/entitlements")
        ? jsonResponse(entitlementsBody(), 200, "2")
        : jsonResponse(providersBody)),
    });
    await expect(sync.sync()).rejects.toBeInstanceOf(ContractMismatchError);
    try {
      await sync.sync();
      expect.unreachable();
    } catch (error) {
      expect((error as ContractMismatchError).code).toBe(MAXIMUS_CONTRACT_MISMATCH);
      expect((error as ContractMismatchError).status).toBe(409);
    }
    // Nothing synced: the view stays the free floor.
    expect(sync.view().granted).toEqual([]);

    const explicit = new EntitlementSync({
      adminOrigin: "https://admin.example.test",
      workspace: WORKSPACE,
      fetchImpl: stubFetch((path) => path.endsWith("/entitlements")
        ? jsonResponse({ error: MAXIMUS_CONTRACT_MISMATCH }, 409)
        : jsonResponse(providersBody)),
    });
    await expect(explicit.sync()).rejects.toBeInstanceOf(ContractMismatchError);
  });

  it("stays on last-good during an outage and degrades expired grace without a restart", async () => {
    let now = Date.now();
    const dir = mkdtempSync(join(tmpdir(), "maximus-entsync-"));
    dirs.push(dir);
    const cacheFile = join(dir, "entitlements.json");
    const graced = () => entitlementsBody({ status: "grace", graceEndsAt: now + 60_000 });
    const sync = new EntitlementSync({
      adminOrigin: "https://admin.example.test",
      workspace: WORKSPACE,
      cacheFile,
      now: () => now,
      fetchImpl: stubFetch((path) => path.endsWith("/entitlements") ? jsonResponse(graced()) : jsonResponse(providersBody)),
    });
    const first = await sync.sync();
    expect(first.status).toBe("grace");
    expect(first.banner?.kind).toBe("grace");
    expect(sync.startupLog()).toContain("payment needs attention");

    const outage = new EntitlementSync({
      adminOrigin: "https://admin.example.test",
      workspace: WORKSPACE,
      cacheFile,
      now: () => now,
      fetchImpl: stubFetch(() => { throw new Error("socket hang up"); }),
    });
    const cached = await outage.sync();
    expect(cached.offline).toBe(true);
    expect(cached.status).toBe("grace");
    expect(cached.granted).toEqual(["admin", "gateway"]);

    now += 2 * 60_000;
    const degraded = outage.view();
    expect(degraded.status).toBe("suspended");
    expect(degraded.granted).toEqual([]);
    expect(degraded.banner?.kind).toBe("suspended");
  });

  it("runs the free tier with a banner when the plane never answered", async () => {
    const sync = new EntitlementSync({
      adminOrigin: "https://admin.example.test",
      workspace: WORKSPACE,
      fetchImpl: stubFetch(() => { throw new Error("ENOTFOUND"); }),
    });
    const view = await sync.sync();
    expect(view).toMatchObject({ status: "suspended", granted: [], offline: true });
    expect(view.banner?.kind).toBe("offline");
    expect(sync.startupLog()).toContain("entitlements unavailable");
  });
});
