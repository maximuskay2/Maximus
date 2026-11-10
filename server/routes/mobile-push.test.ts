import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { PushTokenRow } from "../message-db.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createMobilePushRoutes } from "./mobile-push.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

function row(overrides: Partial<PushTokenRow> = {}): PushTokenRow {
  return {
    token: "tok-abcdef-12345678", platform: "ios", deviceName: "Max's iPhone",
    personKey: null, appVersion: "1.0", createdAt: 1, lastSeenAt: 2, ...overrides,
  };
}

async function serve(options: {
  tokens?: PushTokenRow[];
  sender?: boolean;
  auth?: RequestAuth;
  settings?: Record<string, string>;
} = {}) {
  const tokens = [...(options.tokens ?? [])];
  const settings = { ...(options.settings ?? {}) };
  const sender = options.sender === true
    ? { send: vi.fn(async () => ({ ok: true as const, messageId: "m" })), close: () => {} }
    : null;
  const deps = {
    upsertToken: vi.fn((input: { token: string; platform: string }) => {
      const at = tokens.findIndex((t) => t.token === input.token);
      const next = row({ token: input.token, platform: input.platform });
      if (at >= 0) tokens[at] = next;
      else tokens.push(next);
    }),
    removeToken: vi.fn((token: string) => {
      const at = tokens.findIndex((t) => t.token === token);
      if (at < 0) return false;
      tokens.splice(at, 1);
      return true;
    }),
    listTokens: vi.fn(() => [...tokens]),
    getSetting: vi.fn((key: string) => settings[key] ?? null),
    setSetting: vi.fn((key: string, value: string) => { settings[key] = value; }),
    sender: () => sender,
    actorKey: () => "person:me",
  };
  const routes = [createMobilePushRoutes(deps)];
  const auth: RequestAuth = options.auth ?? { kind: "session", session: { id: "s1" }, via: "bearer", scopes: ["admin", "client"] } as unknown as RequestAuth;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, {
      req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody,
    });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { deps, base, sender };
}

const post = (base: string, path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("mobile push routes", () => {
  it("registers a phone and lists it fingerprinted", async () => {
    const { base } = await serve();
    const res = await post(base, "/v1/installations/self/push/register", {
      token: "fcm-token-1", platform: "ios", deviceName: "Max's iPhone",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, enabled: true });
    const list = await fetch(`${base}/v1/installations/self/push`);
    expect(await list.json()).toEqual({
      enabled: true,
      configured: false,
      devices: [{
        platform: "ios", deviceName: "Max's iPhone", appVersion: "1.0",
        lastSeenAt: 2, fingerprint: "-token-1",
      }],
    });
  });

  it("rejects bad registrations", async () => {
    const { base } = await serve();
    expect((await post(base, "/v1/installations/self/push/register", { token: "", platform: "ios" })).status).toBe(400);
    expect((await post(base, "/v1/installations/self/push/register", { token: "t", platform: "web" })).status).toBe(400);
  });

  it("unregisters by token", async () => {
    const { base } = await serve({ tokens: [row({ token: "gone" })] });
    const res = await fetch(`${base}/v1/installations/self/push/register`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "gone" }),
    });
    expect(await res.json()).toEqual({ ok: true, removed: true });
    const again = await fetch(`${base}/v1/installations/self/push/register`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "gone" }),
    });
    expect(await again.json()).toEqual({ ok: true, removed: false });
  });

  it("gates reads, settings and test sends on admin", async () => {
    const client = { kind: "session", session: { id: "s1" }, via: "bearer", scopes: ["client"] } as unknown as RequestAuth;
    const { base } = await serve({ auth: client });
    // ...but a chat-only phone can still register itself.
    expect((await post(base, "/v1/installations/self/push/register", { token: "t", platform: "android" })).status).toBe(200);
    expect((await fetch(`${base}/v1/installations/self/push`)).status).toBe(403);
    expect((await fetch(`${base}/v1/installations/self/push/settings`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false }),
    })).status).toBe(403);
    expect((await post(base, "/v1/installations/self/push/test", {}))).toBeTruthy();
    expect((await post(base, "/v1/installations/self/push/test", {})).status).toBe(403);
  });

  it("flips the global switch", async () => {
    const { base, deps } = await serve();
    const res = await fetch(`${base}/v1/installations/self/push/settings`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false }),
    });
    expect(await res.json()).toEqual({ ok: true, enabled: false });
    expect(deps.setSetting).toHaveBeenCalledWith("push.enabled", "0");
    const bad = await fetch(`${base}/v1/installations/self/push/settings`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: "no" }),
    });
    expect(bad.status).toBe(400);
  });

  it("test send needs a sender and a phone", async () => {
    const unconfigured = await serve();
    expect((await post(unconfigured.base, "/v1/installations/self/push/test", {})).status).toBe(503);
    const noPhones = await serve({ sender: true });
    expect((await post(noPhones.base, "/v1/installations/self/push/test", {})).status).toBe(404);
    const ready = await serve({ sender: true, tokens: [row()] });
    const res = await post(ready.base, "/v1/installations/self/push/test", { dryRun: true });
    expect(await res.json()).toEqual({ ok: true, dryRun: true });
    expect(ready.sender!.send).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });
});
