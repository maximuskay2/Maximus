import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RationService } from "../billing/ration-service.ts";
import { json, readBody } from "../harness/http.ts";
import { createRationRoutes } from "./ration.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

async function serve(scopes: string[]) {
  const folder = mkdtempSync(join(tmpdir(), "maximus-ration-route-"));
  folders.push(folder);
  const routes = [createRationRoutes({ ration: new RationService({ dataDir: folder }) })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, {
      req, res, url, path: url.pathname, method: req.method ?? "GET",
      auth: { kind: "session", scopes } as never, json, readBody,
    });
    if (!handled) json(res, 404, { error: "missing" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return async (path: string, init?: RequestInit) => {
    const response = await fetch(`${base}${path}`, init);
    return [response.status, await response.json()] as const;
  };
}

describe("/api/admin/ration", () => {
  it("shows the builtin rates to an admin and hides them from a member", async () => {
    const admin = await serve(["admin"]);
    const [status, body] = await admin("/api/admin/ration") as [number, { profile: { freeGrantUsd: number }; pool: { configured: boolean } }];
    expect(status).toBe(200);
    expect(body.profile.freeGrantUsd).toBe(0.012);
    expect(body.pool.configured).toBe(false);
    const member = await serve(["client"]);
    expect((await member("/api/admin/ration"))[0]).toBe(403);
  });

  it("saves a legal edit and refuses a money-losing one", async () => {
    const call = await serve(["admin"]);
    const [, current] = await call("/api/admin/ration") as [number, { profile: { freeGrantUsd: number } }];
    const saved = await call("/api/admin/ration", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...current.profile, freeGrantUsd: 0.05 }),
    }) as [number, { profile: { freeGrantUsd: number } }];
    expect(saved[0]).toBe(200);
    expect(saved[1].profile.freeGrantUsd).toBe(0.05);
    const losing = structuredClone(current.profile) as unknown as { hosted: Array<{ includedCostUsd: number; hardCapUsd: number }> };
    losing.hosted[0]!.includedCostUsd = 15;
    losing.hosted[0]!.hardCapUsd = 15;
    const refused = await call("/api/admin/ration", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(losing),
    });
    expect(refused[0]).toBe(400);
    const [, again] = await call("/api/admin/ration") as [number, { profile: { freeGrantUsd: number } }];
    expect(again.profile.freeGrantUsd).toBe(0.05);
  });

  it("stores a pool key and returns only the last four characters", async () => {
    const call = await serve(["admin"]);
    const [status, body] = await call("/api/admin/ration/pool-key", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "meta-secret-key-9876" }),
    }) as [number, { pool: { configured: boolean; last4: string } }];
    expect(status).toBe(200);
    expect(body.pool).toEqual({ configured: true, last4: "9876" });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("meta-secret");
  });

  it("shows the signed-in wallet and keeps the pooled key off it", async () => {
    const call = await serve(["client"]);
    const [status, body] = await call("/api/ration") as [number, { tier: string; grantedUsd: number; sparkTokens: number; pool?: unknown }];
    expect(status).toBe(200);
    expect(body.tier).toBe("free");
    expect(body.grantedUsd).toBe(0.012);
    expect(body.sparkTokens).toBe(2_823);
    expect(body.pool).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("meta");
    const accepted = await call("/api/ration/contributor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept: true }),
    }) as [number, { contributorAccepted: boolean; sparkTokens: number }];
    expect(accepted[0]).toBe(200);
    expect(accepted[1].contributorAccepted).toBe(true);
    expect(accepted[1].sparkTokens).toBe(60_000);
  });
});
