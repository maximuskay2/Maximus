import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AGENT_OS_STALE_MS } from "../../shared/agent-os.ts";
import { createAgentOs } from "../agent-os.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createAgentOsRoutes } from "./agent-os.ts";
import { PASS, type RouteContext } from "./table.ts";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

async function call(path: string, method: string, body?: unknown, auth: RequestAuth = { kind: "loopback", scopes: ["admin"] }, opts?: { lend?: boolean }) {
  const dataDir = mkdtempSync(join(tmpdir(), "agent-os-http-"));
  folders.push(dataDir);
  if (opts?.lend !== false) {
    writeFileSync(join(dataDir, "lent-computers.json"), JSON.stringify({
      version: 1,
      computers: [{
        id: "office",
        person: "ada",
        name: "Office Mac",
        platform: "darwin",
        folders: 1,
        terminal: true,
        screen: true,
        chrome: true,
        lastSeenAt: Date.now(),
        lastUsedAt: null,
        stoppedAt: null,
      }],
    }));
  }
  const os = createAgentOs({ dataDir, entitled: () => true, self: { name: "Office Mac", kind: "this_desktop" } });
  const handler = createAgentOsRoutes({ os });
  const sent: Array<{ status: number; body: unknown }> = [];
  const out = await handler({
    req: { headers: { "content-type": "application/json" } } as IncomingMessage,
    res: { setHeader() {}, headersSent: false } as unknown as ServerResponse,
    url: new URL(`http://localhost${path}`),
    path: path.split("?")[0]!,
    method,
    auth,
    json: ((_res, status, response) => { sent.push({ status, body: response }); }) as RouteContext["json"],
    readBody: (async () => body ?? {}) as RouteContext["readBody"],
  });
  expect(out).not.toBe(PASS);
  return sent[0]!;
}

describe("Agent OS HTTP", () => {
  it("lists named machines for a signed-in client", async () => {
    const reply = await call("/api/agent-os/machines", "GET", undefined, { kind: "session", via: "cookie", scopes: ["client"], session: { id: "s1", tokenHash: "a".repeat(64), label: "phone", scopes: ["client"], createdAt: 1, lastSeenAt: 1, expiresAt: 9 } });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(expect.objectContaining({ selfId: "self" }));
  });

  it("routes an approved computer turn to a live peer through the shared-computer lease", async () => {
    const reply = await call("/api/agent-os/route", "POST", { machineId: "office", capability: "computer" });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(expect.objectContaining({
      ok: true,
      target: "remote",
      dispatch: "shared-computer",
      leasePath: "/api/shared-computers/office/lease",
    }));
  });

  it("refuses a password in a plug-in invoke", async () => {
    const reply = await call("/api/agent-os/plugins/invoke", "POST", { mode: "browser", app: "canva", action: "list", password: "secret" });
    expect(reply.status).toBe(400);
    expect(String((reply.body as { error: string }).error)).toMatch(/password/i);
  });

  it("writes policy that only narrows", async () => {
    const reply = await call("/api/agent-os/policy", "PUT", { bots: ["clerk"], machines: ["self"], capabilities: ["computer"] });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ bots: ["clerk"], machines: ["self"], capabilities: ["computer"] });
  });

  it("looks up git as this person on this computer", async () => {
    const reply = await call("/api/agent-os/plugins/invoke", "POST", { mode: "local", app: "git", action: "lookup" });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(expect.objectContaining({ app: "git", executed: true, as: "owner" }));
  });

  it("lets a phone approve Canva without attaching Chromium", async () => {
    const reply = await call("/api/agent-os/plugins/invoke", "POST", { mode: "browser", app: "canva", action: "publish", confirm: true }, {
      kind: "session",
      via: "cookie",
      scopes: ["client"],
      session: { id: "s1", tokenHash: "a".repeat(64), label: "phone", scopes: ["client"], createdAt: 1, lastSeenAt: 1, expiresAt: 9 },
    });
    expect(reply.status).toBe(409);
    expect(String((reply.body as { error: string }).error)).toMatch(/only approve/i);
  });

  it("drives Canva on the named desktop only after confirm", async () => {
    const refused = await call("/api/agent-os/plugins/invoke", "POST", { mode: "browser", app: "canva", action: "publish" });
    expect(refused.status).toBe(409);
    const published = await call("/api/agent-os/plugins/invoke", "POST", { mode: "browser", app: "canva", action: "publish", confirm: true });
    expect(published.status).toBe(409);
    expect(String((published.body as { error: string }).error)).toMatch(/Chromium partition/i);
  });

  it("refuses route for a heartbeat-only peer that was never lent", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "agent-os-orphan-http-"));
    folders.push(dataDir);
    const os = createAgentOs({ dataDir, entitled: () => true, self: { name: "Here", kind: "this_desktop" } });
    os.heartbeat({ id: "orphan", name: "Orphan", kind: "lent_peer", capabilities: ["computer"] });
    const handler = createAgentOsRoutes({ os });
    const sent: Array<{ status: number; body: unknown }> = [];
    await handler({
      req: { headers: { "content-type": "application/json" } } as IncomingMessage,
      res: { setHeader() {}, headersSent: false } as unknown as ServerResponse,
      url: new URL("http://localhost/api/agent-os/route"),
      path: "/api/agent-os/route",
      method: "POST",
      auth: { kind: "loopback", scopes: ["admin"] },
      json: ((_res, status, response) => { sent.push({ status, body: response }); }) as RouteContext["json"],
      readBody: async () => ({ machineId: "orphan", capability: "computer" }),
    });
    expect(sent).toHaveLength(1);
    const blocked = sent[0]!;
    expect(blocked.status).toBe(403);
    expect(String((blocked.body as { error: string }).error)).toMatch(/live shared desktop/i);
  });
});

describe("Agent OS overlay HTTP", () => {
  it("lists a lent desktop from lent-computers.json", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "agent-os-overlay-http-"));
    folders.push(dataDir);
    writeFileSync(join(dataDir, "lent-computers.json"), JSON.stringify({
      version: 1,
      computers: [{
        id: "11111111-1111-4111-8111-111111111111",
        person: "ada",
        name: "Office Mac",
        platform: "darwin",
        folders: 0,
        terminal: true,
        screen: true,
        lastSeenAt: Date.now(),
        lastUsedAt: null,
        stoppedAt: null,
      }],
    }));
    const os = createAgentOs({ dataDir, entitled: () => true, self: { name: "Here", kind: "this_desktop" } });
    const handler = createAgentOsRoutes({ os });
    const sent: Array<{ status: number; body: unknown }> = [];
    await handler({
      req: { headers: { "content-type": "application/json" } } as IncomingMessage,
      res: { setHeader() {}, headersSent: false } as unknown as ServerResponse,
      url: new URL("http://localhost/api/agent-os/machines"),
      path: "/api/agent-os/machines",
      method: "GET",
      auth: { kind: "loopback", scopes: ["admin"] },
      json: ((_res, status, response) => { sent.push({ status, body: response }); }) as RouteContext["json"],
      readBody: async () => ({}),
    });
    expect(sent).toHaveLength(1);
    const ids = ((sent[0]!.body as { machines: Array<{ id: string }> }).machines ?? []).map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining(["self", "11111111-1111-4111-8111-111111111111"]));
  });

  it("fails the route when that computer is asleep", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "agent-os-asleep-http-"));
    folders.push(dataDir);
    const clock = { value: 1_000 };
    writeFileSync(join(dataDir, "lent-computers.json"), JSON.stringify({
      version: 1,
      computers: [{
        id: "office",
        person: "ada",
        name: "Office Mac",
        platform: "darwin",
        folders: 1,
        terminal: true,
        screen: true,
        lastSeenAt: clock.value,
        lastUsedAt: null,
        stoppedAt: null,
      }],
    }));
    const os = createAgentOs({ dataDir, now: () => clock.value, entitled: () => true, self: { name: "Here", kind: "this_desktop" } });
    clock.value += AGENT_OS_STALE_MS + 1;
    const handler = createAgentOsRoutes({ os });
    const sent: Array<{ status: number; body: unknown }> = [];
    await handler({
      req: { headers: { "content-type": "application/json" } } as IncomingMessage,
      res: { setHeader() {}, headersSent: false } as unknown as ServerResponse,
      url: new URL("http://localhost/api/agent-os/route"),
      path: "/api/agent-os/route",
      method: "POST",
      auth: { kind: "loopback", scopes: ["admin"] },
      json: ((_res, status, response) => { sent.push({ status, body: response }); }) as RouteContext["json"],
      readBody: async () => ({ machineId: "office", capability: "computer" }),
    });
    expect(sent).toHaveLength(1);
    const asleep = sent[0]!;
    expect(asleep.status).toBe(503);
    expect(asleep.body).toEqual(expect.objectContaining({
      outcome: "offline",
      wait: { machineId: "office", name: "Office Mac" },
    }));
    expect(String((asleep.body as { error: string }).error)).toMatch(/asleep/i);
  });
});
