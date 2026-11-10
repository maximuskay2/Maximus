import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { EmailSignIn } from "./account-signin.ts";
import { configuredOAuthProviders, exchangeOAuthCode, oauthAuthorizeUrl } from "./oauth-signin.ts";
import { createOAuthSignInRoute } from "./routes/oauth-sign-in.ts";
import type { PublicSession, Scope } from "./sessions.ts";

const ENV = {
  MAXIMUS_OAUTH_GOOGLE_CLIENT_ID: "google-client",
  MAXIMUS_OAUTH_GOOGLE_CLIENT_SECRET: "google-secret",
  MAXIMUS_OAUTH_GITHUB_CLIENT_ID: "github-client",
  MAXIMUS_OAUTH_GITHUB_CLIENT_SECRET: "github-secret",
};

function jwt(payload: object): string {
  return `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
}

describe("oauth providers", () => {
  it("lists a provider only when both the client id and the secret are set", () => {
    expect(configuredOAuthProviders({ MAXIMUS_OAUTH_GOOGLE_CLIENT_ID: "id" })).toEqual([]);
    expect(configuredOAuthProviders(ENV).map((provider) => provider.id)).toEqual(["google", "github"]);
  });

  it("builds an authorize URL that carries the client id and not the secret", () => {
    const url = oauthAuthorizeUrl("github", { clientId: "github-client", redirectUri: "http://127.0.0.1:8799/api/auth/oauth/github/callback", state: "abc" });
    expect(url.startsWith("https://github.com/login/oauth/authorize?")).toBe(true);
    expect(url).toContain("client_id=github-client");
    expect(url).not.toContain("github-secret");
  });

  it("keeps an unverified Google address out", async () => {
    const fetchImpl = vi.fn(async (url: string) => Response.json(String(url).includes("token")
      ? { access_token: "tok" }
      : { email: "ada@example.com", email_verified: false, sub: "g1" }));
    const exchanged = await exchangeOAuthCode({
      provider: "google", code: "code", redirectUri: "http://127.0.0.1/cb", env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(exchanged).toEqual({ ok: false, reason: "unverified" });
  });

  it("reads a verified Apple address from the id token", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id_token: jwt({ email: "Ada@Example.com", email_verified: "true", sub: "apple.1" }) }));
    const exchanged = await exchangeOAuthCode({
      provider: "apple", code: "code", redirectUri: "http://127.0.0.1/cb",
      env: { MAXIMUS_OAUTH_APPLE_CLIENT_ID: "apple-client", MAXIMUS_OAUTH_APPLE_CLIENT_SECRET: "apple-secret" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(exchanged).toEqual({ ok: true, email: "ada@example.com", subject: "apple.1" });
  });
});

function capture() {
  const ended: { status?: number; headers?: Record<string, string>; body?: string } = {};
  const set = new Map<string, string>();
  const res = {
    setHeader: (name: string, value: string) => { set.set(name.toLowerCase(), value); },
    writeHead: (status: number, headers?: Record<string, string>) => { ended.status = status; ended.headers = headers; },
    end: (body?: string) => { ended.body = body; },
  } as unknown as ServerResponse;
  return { res, ended, set };
}

function request(url: string, headers: Record<string, string> = {}): IncomingMessage {
  return { url, headers: { host: "127.0.0.1:8799", ...headers }, socket: { remoteAddress: "127.0.0.1" } } as unknown as IncomingMessage;
}

function session(): PublicSession {
  return { id: "s1", label: "Phone", scopes: ["client"], createdAt: 1, lastSeenAt: 1, expiresAt: Date.now() + 60_000, email: "ada@example.com" };
}

function routeFor(fetchImpl: typeof fetch) {
  const issued = { token: "session-token", session: session() };
  const sessions = {
    attemptAllowed: () => ({ ok: true as const }),
    noteFailure: vi.fn(),
    clearFailures: vi.fn(),
    issue: vi.fn((input: { scopes: Scope[]; userId?: string; email?: string }) => ({ ...issued, session: { ...issued.session, scopes: input.scopes, email: input.email } })),
  };
  const emailSignIn = {
    admit: (email: string, userId: string) => email.endsWith("@example.com")
      ? { ok: true as const, email, userId, scopes: ["client"] as Scope[] }
      : { ok: false as const, status: 403, error: "not on the list", errorKey: "serverError.email.notAllowed" as const },
  } as unknown as EmailSignIn;
  const route = createOAuthSignInRoute({
    cloudHome: false, hosted: false, emailSignIn, sessions, cookieName: "maximus_session", environment: () => ({ ok: true }), env: ENV, fetchImpl,
  });
  return { route, sessions };
}

describe("oauth sign-in route", () => {
  it("sends the browser to Google and signs in the confirmed address", async () => {
    const fetchImpl = vi.fn(async (url: string) => Response.json(String(url).includes("token")
      ? { access_token: "tok" }
      : { email: "ada@example.com", email_verified: true, sub: "g1" }));
    const { route, sessions } = routeFor(fetchImpl as unknown as typeof fetch);
    const start = capture();
    await route(request("/api/auth/oauth/google/start?json=1", { accept: "application/json" }), start.res, "/api/auth/oauth/google/start", "GET");
    const started = JSON.parse(start.ended.body ?? "{}") as { url: string };
    expect(started.url).toContain("client_id=google-client");
    expect(started.url).not.toContain("google-secret");
    const state = new URL(started.url).searchParams.get("state");
    const done = capture();
    await route(request(`/api/auth/oauth/google/callback?code=abc&state=${state}`), done.res, "/api/auth/oauth/google/callback", "GET");
    expect(done.ended.status).toBe(302);
    expect(done.ended.headers?.location).toBe("/");
    expect(done.set.get("set-cookie")).toContain("session-token");
    expect(sessions.issue).toHaveBeenCalledWith(expect.objectContaining({ email: "ada@example.com", userId: "oauth:google:g1" }));
  });

  it("hands a phone a one-time ticket instead of the session token", async () => {
    const fetchImpl = vi.fn(async (url: string) => Response.json(String(url).includes("user/emails")
      ? [{ email: "ada@example.com", verified: true, primary: true }]
      : String(url).includes("api.github.com/user")
        ? { id: 42 }
        : { access_token: "tok" }));
    const { route } = routeFor(fetchImpl as unknown as typeof fetch);
    const start = capture();
    await route(request("/api/auth/oauth/github/start?device=1&json=1"), start.res, "/api/auth/oauth/github/start", "GET");
    const state = new URL((JSON.parse(start.ended.body ?? "{}") as { url: string }).url).searchParams.get("state");
    const done = capture();
    await route(request(`/api/auth/oauth/github/callback?code=abc&state=${state}`), done.res, "/api/auth/oauth/github/callback", "GET");
    const location = done.ended.headers?.location ?? "";
    expect(location.startsWith("maximus://oauth?ticket=")).toBe(true);
    expect(location).not.toContain("session-token");
    const ticket = new URL(location).searchParams.get("ticket") ?? "";
    const stream = new Readable({ read() {} });
    const req = Object.assign(stream, { url: "/api/auth/oauth/redeem", headers: { host: "127.0.0.1:8799", "content-type": "application/json" }, socket: { remoteAddress: "127.0.0.1" } }) as unknown as IncomingMessage;
    const redeemed = capture();
    const pending = route(req, redeemed.res, "/api/auth/oauth/redeem", "POST");
    stream.push(JSON.stringify({ ticket }));
    stream.push(null);
    expect(await pending).toBe(true);
    expect(JSON.parse(redeemed.ended.body ?? "{}")).toMatchObject({ session: { email: "ada@example.com" } });
    expect(redeemed.set.get("set-cookie")).toContain("session-token");
  });

  it("refuses a second use of the same state", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ access_token: "tok" }));
    const { route } = routeFor(fetchImpl as unknown as typeof fetch);
    const start = capture();
    await route(request("/api/auth/oauth/google/start?json=1"), start.res, "/api/auth/oauth/google/start", "GET");
    const state = new URL((JSON.parse(start.ended.body ?? "{}") as { url: string }).url).searchParams.get("state");
    const path = `/api/auth/oauth/google/callback?code=abc&state=${state}`;
    await route(request(path), capture().res, "/api/auth/oauth/google/callback", "GET");
    const again = capture();
    await route(request(path), again.res, "/api/auth/oauth/google/callback", "GET");
    expect(again.ended.headers?.location).toContain("/pair?reason=");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
