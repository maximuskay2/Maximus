// OIDC SSO tests: pure scope mapping plus config/callback routes against a
// stub issuer fetch. No live identity provider is ever contacted.
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createAuth } from "../src/auth";
import { readConfig } from "../src/config";
import { createWorker } from "../src/index";
import { mapOidcScopes, sessionScopesForRole } from "../src/sso";

const BASE_URL = "https://auth.maximus.test";
const OIDC_SECRET = "test-only-oidc-client-secret";
let serial = 1000;

function slug(prefix: string): string {
  serial += 1;
  return `${prefix}-${serial}-sso`.toLowerCase();
}

async function call(path: string, options: { method?: string; token?: string; body?: unknown; ssoFetch?: typeof fetch; envOverride?: Record<string, unknown> } = {}) {
  const headers = new Headers();
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const request = new Request(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const ctx = createExecutionContext();
  const testEnv = options.envOverride ? { ...env, ...options.envOverride } : env;
  const worker = createWorker(fetch, fetch, fetch, options.ssoFetch ?? (async () => new Response("no issuer", { status: 500 })));
  const response = await worker.fetch(request, testEnv as Env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function signIn(email: string): Promise<string> {
  const ctx = createExecutionContext();
  const auth = createAuth(env, ctx, readConfig(env), crypto.randomUUID());
  const otp = await auth.api.createVerificationOTP({ body: { email, type: "sign-in" } });
  await waitOnExecutionContext(ctx);
  const response = await call("/api/auth/sign-in/email-otp", {
    method: "POST",
    body: { email, otp, name: email.split("@", 1)[0] },
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-auth-token")!;
}

describe("oidc scope mapping", () => {
  it("maps admin groups/scopes first and defaults to member", () => {
    const mapping = { groups: { "maximus-admins": "admin" as const }, scopes: { admin: "admin" as const }, defaultRole: "member" as const };
    expect(mapOidcScopes(mapping, { groups: ["maximus-admins"], scopes: [] })).toBe("admin");
    expect(mapOidcScopes(mapping, { groups: [], scopes: ["admin"] })).toBe("admin");
    expect(mapOidcScopes(mapping, { groups: ["everyone"], scopes: ["openid"] })).toBe("member");
    expect(mapOidcScopes({}, { groups: [], scopes: [] })).toBe("member");
    expect(mapOidcScopes({ defaultRole: "admin" }, { groups: [], scopes: [] })).toBe("admin");
  });

  it("derives session scopes from the role", () => {
    expect(sessionScopesForRole("admin")).toEqual(["admin", "client"]);
    expect(sessionScopesForRole("member")).toEqual(["client"]);
  });
});

describe("oidc routes", () => {
  it("lets an admin configure SSO and rejects members", async () => {
    const admin = await signIn(`sso-admin-${serial}@example.test`);
    const member = await signIn(`sso-member-${serial}@example.test`);
    const workspace = slug("ws");
    const created = await call("/api/auth/signup", { method: "POST", token: admin, body: { workspace } });
    expect(created.status).toBe(201);

    const put = await call("/api/auth/oidc/config", {
      method: "PUT",
      token: admin,
      body: {
        workspace,
        issuer: "https://issuer.example.test/tenant",
        clientId: "maximus-client",
        mapping: { groups: { "maximus-admins": "admin" }, defaultRole: "member" },
      },
    });
    expect(put.status).toBe(200);
    const putBody = await put.json() as { oidc: { issuer: string; clientId: string; enabled: boolean } };
    expect(putBody.oidc).toMatchObject({ issuer: "https://issuer.example.test/tenant", clientId: "maximus-client", enabled: true });

    const get = await call(`/api/auth/oidc/config?workspace=${workspace}`, { token: admin });
    expect(get.status).toBe(200);

    const badIssuer = await call("/api/auth/oidc/config", {
      method: "PUT",
      token: admin,
      body: { workspace, issuer: "http://insecure.example.test", clientId: "x" },
    });
    expect(badIssuer.status).toBe(400);

    const memberPut = await call("/api/auth/oidc/config", {
      method: "PUT",
      token: member,
      body: { workspace, issuer: "https://issuer.example.test", clientId: "x" },
    });
    expect(memberPut.status).toBe(404);
  });

  it("exchanges a code at the stub issuer and maps the role", async () => {
    const email = `sso-user-${serial}@example.test`;
    const admin = await signIn(email);
    const workspace = slug("ws");
    await call("/api/auth/signup", { method: "POST", token: admin, body: { workspace } });
    await call("/api/auth/oidc/config", {
      method: "PUT",
      token: admin,
      body: {
        workspace,
        issuer: "https://issuer.example.test",
        clientId: "maximus-client",
        mapping: { groups: { "maximus-admins": "admin" }, defaultRole: "member" },
      },
    });

    const stubFetch: typeof fetch = (async (url: unknown) => {
      const target = String(url);
      if (target.endsWith("/token")) {
        return new Response(JSON.stringify({ access_token: "stub-access", id_token: "stub-id" }), { status: 200 });
      }
      if (target.endsWith("/userinfo")) {
        return new Response(JSON.stringify({
          sub: "user-123",
          email,
          email_verified: true,
          groups: ["maximus-admins"],
          scope: "openid profile",
        }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const noSecret = await call("/api/auth/oidc/callback", {
      method: "POST",
      token: admin,
      body: { workspace, code: "auth-code", redirectUri: "https://app.maximus.test/callback" },
      ssoFetch: stubFetch,
    });
    expect(noSecret.status).toBe(503);

    const ok = await call("/api/auth/oidc/callback", {
      method: "POST",
      token: admin,
      body: { workspace, code: "auth-code", redirectUri: "https://app.maximus.test/callback" },
      ssoFetch: stubFetch,
      envOverride: { MAXIMUS_OIDC_CLIENT_SECRET: OIDC_SECRET },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ sso: { workspace, role: "admin", scopes: ["admin", "client"] } });

    const badCode: typeof fetch = (async () => new Response("denied", { status: 401 })) as typeof fetch;
    const denied = await call("/api/auth/oidc/callback", {
      method: "POST",
      token: admin,
      body: { workspace, code: "bad-code", redirectUri: "https://app.maximus.test/callback" },
      ssoFetch: badCode,
      envOverride: { MAXIMUS_OIDC_CLIENT_SECRET: OIDC_SECRET },
    });
    expect(denied.status).toBe(401);
  });
});
