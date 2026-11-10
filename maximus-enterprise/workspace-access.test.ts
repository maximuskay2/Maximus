// Copyright (c) 2026 Maximus. All rights reserved.
// Proprietary and confidential: licensed under the Maximus Enterprise License
// (maximus-enterprise/LICENSE), not the Apache License 2.0.
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceAccess } from "./workspace-access.ts";

const ENV = {
  MAXIMUS_ADMIN_URL: "https://admin.example.test",
  MAXIMUS_PUBLIC_URL: "https://acme.example.test",
  MAXIMUS_ADMIN_WORKSPACE: "acme",
  MAXIMUS_ADMIN_MEMBERSHIP: "portal",
};
const GRANT = "g".repeat(43);

interface FakeSessions {
  live: Set<string>;
  failures: Map<string, number>;
  issued: Array<{ email: string; grant: string; scopes: string[] }>;
  revoked: string[];
  records: Map<string, { id: string; email?: string; scopes: string[]; membershipAuthority?: string }>;
  attemptAllowed: (_source: string) => { ok: true } | { ok: false; retryAfterMs: number };
  noteFailure: (source: string) => void;
  clearFailures: (source: string) => void;
  issuePortal: (input: { email: string; grant: string; scopes: string[] }) => { token: string; session: { id: string; expiresAt: number } };
  isLive: (sessionId: string) => boolean;
  list: () => Array<{ id: string; email?: string; scopes: string[] }>;
  authenticate: (token: string | undefined) => { id: string; email?: string; scopes: string[]; membershipAuthority?: string } | null;
  revoke: (id: string) => boolean;
}

function fakeSessions(): FakeSessions {
  const sessions: FakeSessions = {
    live: new Set<string>(["sess-live"]),
    failures: new Map<string, number>(),
    issued: [],
    revoked: [],
    records: new Map([
      ["sess-live", { id: "sess-live", email: "member@example.test", scopes: ["admin", "client"], membershipAuthority: "portal" }],
      ["sess-local", { id: "sess-local", scopes: ["admin", "client"] }],
    ]),
    attemptAllowed: vi.fn((_source: string): { ok: true } | { ok: false; retryAfterMs: number } => ({ ok: true })),
    noteFailure: (source: string) => void sessions.failures.set(source, (sessions.failures.get(source) ?? 0) + 1),
    clearFailures: (source: string) => void sessions.failures.delete(source),
    issuePortal: (input: { email: string; grant: string; scopes: string[] }) => {
      sessions.issued.push(input);
      return { token: "portal-token", session: { id: "sess-new", expiresAt: Date.now() + 3_600_000 } };
    },
    isLive: (sessionId: string) => sessions.live.has(sessionId),
    list: () => [...sessions.records.values()].filter((record) => sessions.live.has(record.id))
      .map((record) => ({ id: record.id, email: record.email, scopes: record.scopes })),
    authenticate: (token: string | undefined) => {
      if (token === "live-cookie-token") return sessions.records.get("sess-live")!;
      return null;
    },
    revoke: (id: string) => {
      sessions.revoked.push(id);
      sessions.live.delete(id);
      return true;
    },
  };
  return sessions;
}

function fakeReq(options: { method?: string; path?: string; headers?: Record<string, string>; body?: unknown }): IncomingMessage {
  const emitter = new EventEmitter() as unknown as IncomingMessage;
  emitter.method = options.method ?? "GET";
  emitter.url = options.path ?? "/";
  emitter.headers = options.headers ?? {};
  (emitter as unknown as { socket: object }).socket = { remoteAddress: "127.0.0.1" };
  const text = options.body === undefined ? "" : JSON.stringify(options.body);
  (emitter as unknown as AsyncIterable<Buffer>)[Symbol.asyncIterator] = async function* () {
    if (text) yield Buffer.from(text, "utf8");
  };
  return emitter;
}

function fakeRes() {
  const headers: Record<string, string | string[]> = {};
  const res = {
    status: 0,
    text: "",
    headers,
    location: undefined as string | undefined,
    writeHead(status: number, responseHeaders: Record<string, string>) {
      res.status = status;
      for (const [name, value] of Object.entries(responseHeaders)) {
        if (name.toLowerCase() === "location") res.location = value;
        else headers[name.toLowerCase()] = value;
      }
      return res;
    },
    setHeader(name: string, value: string | string[]) {
      headers[name.toLowerCase()] = value;
    },
    end(text?: string) {
      res.text = text ?? "";
      return res;
    },
  };
  return res as unknown as ServerResponse & { status: number; text: string; headers: Record<string, string | string[]>; location?: string };
}

const urlOf = (req: IncomingMessage) => new URL(req.url ?? "/", "http://127.0.0.1");
const REMOTE = { host: "acme.example.test", "x-forwarded-for": "203.0.113.8", "x-forwarded-proto": "https" };

describe("workspace access adapter", () => {
  it("leaves non-hosted routes and loopback navigation to core", async () => {
    const sessions = fakeSessions();
    const access = createWorkspaceAccess({
      sessions: sessions as never,
      cookieName: "maximus_session",
      closeSessionStreams: () => {},
      entitled: () => true,
      env: ENV,
    });
    for (const path of ["/api/health", "/api/auth/pair", "/api/auth/hosted/other"]) {
      const res = fakeRes();
      expect(await access.handlePublic(fakeReq({ path, headers: REMOTE }), res, urlOf(fakeReq({ path })))).toBe(false);
    }
    for (const path of ["/", "/pair"]) {
      const res = fakeRes();
      expect(await access.handlePublic(fakeReq({ path }), res, urlOf(fakeReq({ path })))).toBe(false);
    }
    const res = fakeRes();
    const req = fakeReq({ path: "/", headers: { ...REMOTE, cookie: "maximus_session=live-cookie-token" } });
    expect(await access.handlePublic(req, res, urlOf(req))).toBe(false);
  });

  it("redirects remote navigation without a portal session into the portal sign-in", async () => {
    const sessions = fakeSessions();
    const access = createWorkspaceAccess({
      sessions: sessions as never,
      cookieName: "maximus_session",
      closeSessionStreams: () => {},
      entitled: () => true,
      env: ENV,
    });
    for (const path of ["/", "/pair"]) {
      const res = fakeRes();
      const req = fakeReq({ path, headers: REMOTE });
      expect(await access.handlePublic(req, res, urlOf(req))).toBe(true);
      expect(res.status).toBe(302);
      expect(res.location).toBe("/api/auth/hosted/start");
    }
  });

  it("starts a portal sign-in with bounded state and a PKCE challenge", async () => {
    const sessions = fakeSessions();
    const access = createWorkspaceAccess({
      sessions: sessions as never,
      cookieName: "maximus_session",
      closeSessionStreams: () => {},
      entitled: () => true,
      env: ENV,
    });
    const res = fakeRes();
    const req = fakeReq({ path: "/api/auth/hosted/start", headers: REMOTE });
    expect(await access.handlePublic(req, res, urlOf(req))).toBe(true);
    expect(res.status).toBe(302);
    const login = new URL(res.location!);
    expect(login.origin).toBe("https://admin.example.test");
    expect(login.pathname).toBe("/connect");
    expect(login.searchParams.get("workspace")).toBe("acme");
    expect(login.searchParams.get("code_challenge_method")).toBe("S256");
    const state = login.searchParams.get("state")!;
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(login.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(String(res.headers["set-cookie"])).toContain(`__Host-maximus-portal-state=${state}`);
  });

  it("bounds pending starts per source without evicting them", async () => {
    const sessions = fakeSessions();
    const access = createWorkspaceAccess({
      sessions: sessions as never,
      cookieName: "maximus_session",
      closeSessionStreams: () => {},
      entitled: () => true,
      env: ENV,
      fetchImpl: (async () => Response.json({ contractVersion: 1, email: "member@example.test", role: "member", grant: GRANT })) as typeof fetch,
    });
    const states: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const res = fakeRes();
      const req = fakeReq({ path: "/api/auth/hosted/start", headers: REMOTE });
      expect(await access.handlePublic(req, res, urlOf(req))).toBe(true);
      expect(res.status).toBe(302);
      states.push(new URL(res.location!).searchParams.get("state")!);
    }
    expect(new Set(states).size).toBe(10);
    const full = fakeRes();
    const fullReq = fakeReq({ path: "/api/auth/hosted/start", headers: REMOTE });
    expect(await access.handlePublic(fullReq, full, urlOf(fullReq))).toBe(true);
    expect(full.status).toBe(429);
    // Nothing was evicted: the first start still redeems.
    const first = states[0]!;
    const req = fakeReq({ path: `/api/auth/hosted/callback?state=${first}&code=${GRANT}`,
      headers: { ...REMOTE, cookie: `__Host-maximus-portal-state=${first}` } });
    const res = fakeRes();
    expect(await access.handlePublic(req, res, urlOf(req))).toBe(true);
    expect(res.status).toBe(302);
  });

  it("redeems the callback code with the PKCE verifier and consumes state first", async () => {
    const sessions = fakeSessions();
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const access = createWorkspaceAccess({
      sessions: sessions as never,
      cookieName: "maximus_session",
      closeSessionStreams: () => {},
      entitled: () => true,
      env: ENV,
      fetchImpl: (async (url: string | URL, init?: { body?: unknown }) => {
        seen.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return Response.json({ contractVersion: 1, email: "member@example.test", role: "admin", grant: GRANT });
      }) as typeof fetch,
    });
    const started = fakeRes();
    const startReq = fakeReq({ path: "/api/auth/hosted/start", headers: REMOTE });
    await access.handlePublic(startReq, started, urlOf(startReq));
    const state = new URL(started.location!).searchParams.get("state")!;
    const challenge = new URL(started.location!).searchParams.get("code_challenge")!;
    const req = fakeReq({ path: `/api/auth/hosted/callback?state=${state}&code=${GRANT}`,
      headers: { ...REMOTE, cookie: `__Host-maximus-portal-state=${state}` } });
    const res = fakeRes();
    expect(await access.handlePublic(req, res, urlOf(req))).toBe(true);
    expect(res.status).toBe(302);
    expect(res.location).toBe("/");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://admin.example.test/api/handoff/consume");
    expect(seen[0]!.body).toMatchObject({ workspace: "acme", code: GRANT, contractVersion: 1 });
    // The verifier sent matches the challenge from start (SHA-256 PKCE).
    expect(createHash("sha256").update(String(seen[0]!.body["verifier"]), "utf8").digest("base64url")).toBe(challenge);
    expect(sessions.issued).toEqual([{ email: "member@example.test", grant: GRANT, scopes: ["admin", "client"] }]);
    const cookies = res.headers["set-cookie"] as string[];
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("__Host-maximus-portal-state=; ");
    expect(cookies[1]).toContain("maximus_session=portal-token");
    // Replay of the consumed state fails without another backchannel call.
    const replay = fakeRes();
    expect(await access.handlePublic(req, replay, urlOf(req))).toBe(true);
    expect(replay.status).toBe(400);
    expect(seen).toHaveLength(1);
  });

  it("refuses callback mismatches without granting anything", async () => {
    const sessions = fakeSessions();
    let adminCalls = 0;
    const access = createWorkspaceAccess({
      sessions: sessions as never,
      cookieName: "maximus_session",
      closeSessionStreams: () => {},
      entitled: () => true,
      env: ENV,
      fetchImpl: (async () => { adminCalls += 1; return Response.json({}); }) as typeof fetch,
    });
    const started = fakeRes();
    const startReq = fakeReq({ path: "/api/auth/hosted/start", headers: REMOTE });
    await access.handlePublic(startReq, started, urlOf(startReq));
    const state = new URL(started.location!).searchParams.get("state")!;
    // Wrong state cookie never reaches the admin origin.
    let req = fakeReq({ path: `/api/auth/hosted/callback?state=${state}&code=${GRANT}`,
      headers: { ...REMOTE, cookie: `__Host-maximus-portal-state=${"x".repeat(43)}` } });
    let res = fakeRes();
    expect(await access.handlePublic(req, res, urlOf(req))).toBe(true);
    expect(res.status).toBe(400);
    expect(adminCalls).toBe(0);
    // Unknown state never reaches the admin origin.
    req = fakeReq({ path: `/api/auth/hosted/callback?state=${"y".repeat(43)}&code=${GRANT}`,
      headers: { ...REMOTE, cookie: `__Host-maximus-portal-state=${"y".repeat(43)}` } });
    res = fakeRes();
    expect(await access.handlePublic(req, res, urlOf(req))).toBe(true);
    expect(res.status).toBe(400);
    expect(adminCalls).toBe(0);
    // Malformed code consumes state, then fails without a backchannel call.
    req = fakeReq({ path: `/api/auth/hosted/callback?state=${state}&code=short`,
      headers: { ...REMOTE, cookie: `__Host-maximus-portal-state=${state}` } });
    res = fakeRes();
    expect(await access.handlePublic(req, res, urlOf(req))).toBe(true);
    expect(res.status).toBe(401);
    expect(adminCalls).toBe(0);
    expect(sessions.issued).toEqual([]);
  });

  it("fails the callback closed on backchannel refusals", async () => {
    const callback = async (admin: () => Response | Promise<Response>) => {
      const sessions = fakeSessions();
      const access = createWorkspaceAccess({
        sessions: sessions as never,
        cookieName: "maximus_session",
        closeSessionStreams: () => {},
        entitled: () => true,
        env: ENV,
        fetchImpl: (async () => admin()) as typeof fetch,
      });
      const started = fakeRes();
      const startReq = fakeReq({ path: "/api/auth/hosted/start", headers: REMOTE });
      await access.handlePublic(startReq, started, urlOf(startReq));
      const state = new URL(started.location!).searchParams.get("state")!;
      const req = fakeReq({ path: `/api/auth/hosted/callback?state=${state}&code=${GRANT}`,
        headers: { ...REMOTE, cookie: `__Host-maximus-portal-state=${state}` } });
      const res = fakeRes();
      expect(await access.handlePublic(req, res, urlOf(req))).toBe(true);
      return { res, sessions };
    };
    let refused = await callback(() => new Response("{}", { status: 401 }));
    expect(refused.res.status).toBe(401);
    expect(JSON.parse(refused.res.text).error).toContain("portal");
    refused = await callback(() => { throw new Error("down"); });
    expect(refused.res.status).toBe(503);
    refused = await callback(() => Response.json({ code: "MAXIMUS_CONTRACT_MISMATCH" }, { status: 409 }));
    expect(refused.res.status).toBe(503);
    expect(JSON.parse(refused.res.text).error).toContain("incompatible");
    // An explicit future contract version is a mismatch, never a silent downgrade.
    refused = await callback(() => Response.json({ contractVersion: 2, email: "m@e.test", role: "admin", grant: GRANT }));
    expect(refused.res.status).toBe(503);
    expect(JSON.parse(refused.res.text).error).toContain("incompatible");
    // Legacy-v1: an omitted version reads as the v1 payload.
    refused = await callback(() => Response.json({ email: "member@example.test", role: "member", grant: GRANT }));
    expect(refused.res.status).toBe(302);
    expect(refused.sessions.issued).toEqual([{ email: "member@example.test", grant: GRANT, scopes: ["client"] }]);
    expect(refused.sessions.issued).toHaveLength(1);
  });

  it("rate-limits callback guessing", async () => {
    const sessions = fakeSessions();
    sessions.attemptAllowed = vi.fn(() => ({ ok: false as const, retryAfterMs: 30_000 }));
    const access = createWorkspaceAccess({
      sessions: sessions as never,
      cookieName: "maximus_session",
      closeSessionStreams: () => {},
      entitled: () => true,
      env: ENV,
    });
    const state = "s".repeat(43);
    const req = fakeReq({ path: `/api/auth/hosted/callback?state=${state}&code=${GRANT}`,
      headers: { ...REMOTE, cookie: `__Host-maximus-portal-state=${state}` } });
    const res = fakeRes();
    expect(await access.handlePublic(req, res, urlOf(req))).toBe(true);
    expect(res.status).toBe(429);
  });

  it("authorizes portal sessions against the portal's current verdict", async () => {
    const check = async (options: {
      session?: { id: string; email?: string; scopes: string[]; membershipAuthority?: string };
      entitled?: boolean;
      admin?: () => Response | Promise<Response>;
    }) => {
      const sessions = fakeSessions();
      const closed: string[] = [];
      const access = createWorkspaceAccess({
        sessions: sessions as never,
        cookieName: "c",
        closeSessionStreams: (sessionId: string) => void closed.push(sessionId),
        entitled: () => options.entitled ?? true,
        env: ENV,
        fetchImpl: (async () => options.admin?.() ?? Response.json({ contractVersion: 1, email: "member@example.test", role: "admin" })) as typeof fetch,
      });
      const auth = options.session === undefined
        ? { kind: "loopback", scopes: [] }
        : { kind: "session", session: options.session, scopes: options.session.scopes };
      return { verdict: await access.authorize({} as never, auth as never), sessions, closed };
    };
    const portal = { id: "sess-live", email: "member@example.test", scopes: ["admin", "client"], membershipAuthority: "portal" };
    expect((await check({})).verdict).toBeNull();
    expect((await check({ session: portal })).verdict).toBeNull();
    expect((await check({ session: { id: "sess-local", scopes: ["admin", "client"] } })).verdict).toMatchObject({ status: 401 });
    expect((await check({ session: { ...portal, id: "sess-dead" } })).verdict).toMatchObject({ status: 401 });
    // A promotion never widens the existing credential, and never ends it either.
    const promoted = await check({
      session: { id: "sess-live", email: "member@example.test", scopes: ["client"], membershipAuthority: "portal" },
      admin: () => Response.json({ contractVersion: 1, email: "member@example.test", role: "admin" }),
    });
    expect(promoted.verdict).toBeNull();
    expect(promoted.sessions.revoked).toEqual([]);
    // A demotion ends the session and its streams.
    const demoted = await check({
      session: portal,
      admin: () => Response.json({ contractVersion: 1, email: "member@example.test", role: "member" }),
    });
    expect(demoted.verdict).toMatchObject({ status: 401 });
    expect(demoted.sessions.revoked).toEqual(["sess-live"]);
    expect(demoted.closed).toEqual(["sess-live"]);
    // A revocation ends the session and its streams.
    const revoked = await check({
      session: portal,
      admin: () => new Response("{}", { status: 401 }),
    });
    expect(revoked.verdict).toMatchObject({ status: 401 });
    expect(revoked.sessions.revoked).toEqual(["sess-live"]);
    // An outage denies access and closes streams but preserves the session for recovery.
    const outage = await check({
      session: portal,
      admin: () => { throw new Error("down"); },
    });
    expect(outage.verdict).toMatchObject({ status: 503 });
    expect(outage.sessions.revoked).toEqual([]);
    expect(outage.closed).toEqual(["sess-live"]);
    // A contract mismatch behaves like an outage: deny, close, preserve.
    const mismatch = await check({
      session: portal,
      admin: () => Response.json({ code: "MAXIMUS_CONTRACT_MISMATCH" }, { status: 409 }),
    });
    expect(mismatch.verdict).toMatchObject({ status: 503, error: expect.stringContaining("incompatible") });
    expect(mismatch.sessions.revoked).toEqual([]);
    expect((await check({ session: portal, entitled: false })).verdict).toMatchObject({ status: 503 });
  });

  it("revalidates quiet streams against the portal without dropping sessions on outages", async () => {
    const setup = (admin: () => Response | Promise<Response>) => {
      const sessions = fakeSessions();
      const closed: string[] = [];
      const access = createWorkspaceAccess({
        sessions: sessions as never,
        cookieName: "c",
        closeSessionStreams: (sessionId: string) => void closed.push(sessionId),
        entitled: () => true,
        env: ENV,
        fetchImpl: (async () => admin()) as typeof fetch,
      });
      return { sessions, closed, access };
    };
    const healthy = setup(() => Response.json({ contractVersion: 1, email: "member@example.test", role: "admin" }));
    await healthy.access.revalidate();
    expect(healthy.closed).toEqual([]);
    const outage = setup(() => { throw new Error("down"); });
    await outage.access.revalidate();
    expect(outage.sessions.revoked).toEqual([]);
    expect(outage.closed).toEqual(["sess-live"]);
    const revoked = setup(() => new Response("{}", { status: 401 }));
    await revoked.access.revalidate();
    expect(revoked.sessions.revoked).toEqual(["sess-live"]);
    expect(revoked.closed).toEqual(["sess-live"]);
    const demoted = setup(() => Response.json({ contractVersion: 1, email: "member@example.test", role: "member" }));
    await demoted.access.revalidate();
    expect(demoted.sessions.revoked).toEqual(["sess-live"]);
    expect(demoted.closed).toEqual(["sess-live"]);
  });
});
