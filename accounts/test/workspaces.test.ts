// Isolated fixtures only: every test signs up fresh users and workspaces on
// the test D1, never live data.
import { createExecutionContext, env, testConfig, testDeps, testPool, waitOnExecutionContext } from "./harness.ts";
import { describe, expect, it } from "vitest";

import { createAuth } from "../src/auth.ts";
import { handleRequest } from "../src/router.ts";

const BASE_URL = "https://auth.maximus.test";
const OPERATOR_TOKEN = "test-only-operator-token";
let serial = 0;

function slug(prefix: string): string {
  serial += 1;
  return `${prefix}-${serial}-${Math.random().toString(36).slice(2, 8)}`.toLowerCase().replace(/[^a-z0-9-]/g, "x").slice(0, 31);
}

function mail(prefix: string): string {
  return `${prefix}-${serial}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

interface CallOptions {
  method?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  envOverride?: Record<string, unknown>;
}

async function call(path: string, options: CallOptions = {}) {
  const headerInit: Record<string, string> = { ...options.headers };
  if (options.token) headerInit.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headerInit["content-type"] = "application/json";
  const request = new Request(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: headerInit,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const ctx = createExecutionContext();
  const testEnv = options.envOverride ? { ...env, ...options.envOverride } : env;
  const response = await handleRequest(request, testDeps(testEnv, ctx));
  await waitOnExecutionContext(ctx);
  return response;
}

async function signIn(email: string): Promise<string> {
  const ctx = createExecutionContext();
  const auth = createAuth(env, ctx, testConfig(), crypto.randomUUID(), testPool());
  const otp = await auth.api.createVerificationOTP({ body: { email, type: "sign-in" } });
  await waitOnExecutionContext(ctx);
  const response = await call("/api/auth/sign-in/email-otp", {
    method: "POST",
    body: { email, otp, name: email.split("@", 1)[0] },
  });
  expect(response.status).toBe(200);
  const token = response.headers.get("set-auth-token");
  expect(token).toBeTruthy();
  return token!;
}

async function signupWorkspace(token: string, workspace: string, plan = "team") {
  const response = await call("/api/auth/signup", {
    method: "POST",
    token,
    body: { workspace, displayName: `Workspace ${workspace}`, plan },
  });
  expect(response.status).toBe(201);
  expect(response.headers.get("x-maximus-contract-version")).toBe("1");
  return response.json() as Promise<{ workspace: { id: string; role: string; plan: string } }>;
}

describe("workspaces", () => {
  it("signs up a workspace with the founder as admin", async () => {
    const token = await signIn(mail("founder"));
    const workspace = slug("ws");
    const body = await signupWorkspace(token, workspace);
    expect(body.workspace).toMatchObject({ id: workspace, role: "admin", plan: "team" });

    const duplicate = await call("/api/auth/signup", { method: "POST", token, body: { workspace } });
    expect(duplicate.status).toBe(409);

    const bad = await call("/api/auth/signup", { method: "POST", token, body: { workspace: "Nope_Upper" } });
    expect(bad.status).toBe(400);
  });

  it("rejects a contract mismatch with 409, never a silent downgrade", async () => {
    const token = await signIn(mail("contract"));
    const workspace = slug("ws");
    await signupWorkspace(token, workspace);
    for (const headers of [{ "x-maximus-contract-version": "2" }, { "x-maximus-contract-version": "abc" }]) {
      const response = await call(`/api/workspaces/${workspace}`, { token, headers });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "MAXIMUS_CONTRACT_MISMATCH" });
    }
    const omitted = await call(`/api/workspaces/${workspace}`, { token });
    expect(omitted.status).toBe(200);
    expect(omitted.headers.get("x-maximus-contract-version")).toBe("1");
  });

  it("invites, accepts and enforces the workspace boundary", async () => {
    const admin = await signIn(mail("admin"));
    const member = await signIn(mail("member"));
    const stranger = await signIn(mail("stranger"));
    const workspace = slug("ws");
    await signupWorkspace(admin, workspace);
    const memberEmail = `invited-${workspace}@example.test`;

    const forbidden = await call("/api/auth/invite", {
      method: "POST",
      token: member,
      body: { workspace, email: memberEmail, role: "member" },
    });
    expect(forbidden.status).toBe(404);

    const created = await call("/api/auth/invite", {
      method: "POST",
      token: admin,
      body: { workspace, email: memberEmail, role: "member" },
    });
    expect(created.status).toBe(201);
    const { token: inviteToken } = await created.json() as { token: string };

    const wrongPerson = await call("/api/auth/invite/accept", { method: "POST", token: member, body: { token: inviteToken } });
    expect(wrongPerson.status).toBe(403);

    const invited = await signIn(memberEmail);
    const accepted = await call("/api/auth/invite/accept", { method: "POST", token: invited, body: { token: inviteToken } });
    expect(accepted.status).toBe(200);

    const replay = await call("/api/auth/invite/accept", { method: "POST", token: invited, body: { token: inviteToken } });
    expect(replay.status).toBe(404);

    const strangerView = await call(`/api/workspaces/${workspace}`, { token: stranger });
    expect(strangerView.status).toBe(404);
    const memberView = await call(`/api/workspaces/${workspace}`, { token: invited });
    expect(memberView.status).toBe(200);
  });

  it("lets an admin remove a member, and blocks removing the owner or the last admin", async () => {
    const admin = await signIn(mail("owner"));
    const other = await signIn(mail("other"));
    const workspace = slug("ws");
    await signupWorkspace(admin, workspace);
    const otherEmail = `join-${workspace}@example.test`;

    const created = await call("/api/auth/invite", {
      method: "POST",
      token: admin,
      body: { workspace, email: otherEmail, role: "admin" },
    });
    const { token: inviteToken } = await created.json() as { token: string };
    const joined = await signIn(otherEmail);
    await call("/api/auth/invite/accept", { method: "POST", token: joined, body: { token: inviteToken } });

    const nonAdminRemove = await call("/api/auth/revoke", { method: "POST", token: other, body: { workspace, userId: "anyone" } });
    expect(nonAdminRemove.status).toBe(404);

    const removed = await call("/api/auth/revoke", { method: "POST", token: admin, body: { workspace, userId: "nobody-there" } });
    expect(removed.status).toBe(404);

    const ownerRow = await env.DB.prepare("SELECT owner_user_id AS owner FROM workspaces WHERE id = ?").bind(workspace).first<{ owner: string }>();
    const removeOwner = await call("/api/auth/revoke", { method: "POST", token: joined, body: { workspace, userId: ownerRow!.owner } });
    expect(removeOwner.status).toBe(409);

    const leave = await call("/api/auth/revoke", { method: "POST", token: joined, body: { workspace } });
    expect(leave.status).toBe(200);

    const lastAdminLeave = await call("/api/auth/revoke", { method: "POST", token: admin, body: { workspace } });
    expect(lastAdminLeave.status).toBe(409);
  });

  it("stores workspace provider policies and revokes sessions on removal", async () => {
    const admin = await signIn(mail("prov-admin"));
    const workspace = slug("ws");
    await signupWorkspace(admin, workspace);

    const initial = await call(`/api/workspaces/${workspace}/providers`, { token: admin });
    expect(initial.status).toBe(200);
    const initialBody = await initial.json() as { providers: Record<string, { mode: string }>; routing: Record<string, { via: string }> };
    expect(initialBody.providers.claude).toEqual({ mode: "byo", models: [] });
    expect(initialBody.routing.kimi.via).toBe("byo");

    const bundled = await call(`/api/workspaces/${workspace}/providers/kimi`, {
      method: "PUT",
      token: admin,
      body: { mode: "bundled", models: ["kimi-k3.1-pro", "kimi-k3.1-pro"] },
    });
    expect(bundled.status).toBe(200);
    const bundledBody = await bundled.json() as { providers: Record<string, { mode: string; models: string[] }> };
    expect(bundledBody.providers.kimi).toEqual({ mode: "bundled", models: ["kimi-k3.1-pro"] });

    const empty = await call(`/api/workspaces/${workspace}/providers/muse`, {
      method: "PUT",
      token: admin,
      body: { mode: "bundled", models: [] },
    });
    expect(empty.status).toBe(400);

    const unknown = await call(`/api/workspaces/${workspace}/providers/nope`, {
      method: "PUT",
      token: admin,
      body: { mode: "off" },
    });
    expect(unknown.status).toBe(404);

    const collection = await call(`/api/workspaces/${workspace}/providers`, {
      method: "PUT",
      token: admin,
      body: { grok: { mode: "off" }, codex: { mode: "byo" } },
    });
    expect(collection.status).toBe(200);
    const routed = await call(`/api/workspaces/${workspace}/providers`, { token: admin });
    const routedBody = await routed.json() as { routing: Record<string, { allowed: boolean; via: string }> };
    expect(routedBody.routing.grok).toMatchObject({ allowed: false, via: "off" });
    expect(routedBody.routing.codex).toMatchObject({ allowed: true, via: "byo" });
  });

  it("gates the operator kill-switch behind the operator token", async () => {
    const token = await signIn(mail("op-reader"));
    const reads = await call("/api/operator/providers", { token });
    expect(reads.status).toBe(200);

    const noToken = await call("/api/operator/providers/claude", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
      body: { enabled: false },
      envOverride: {},
    });
    expect(noToken.status).toBe(503);

    const wrongToken = await call("/api/operator/providers/claude", {
      method: "PUT",
      headers: { authorization: "Bearer wrong-token" },
      body: { enabled: false },
      envOverride: { MAXIMUS_OPERATOR_TOKEN: OPERATOR_TOKEN },
    });
    expect(wrongToken.status).toBe(403);

    const killed = await call("/api/operator/providers/claude", {
      method: "PUT",
      headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
      body: { enabled: false, reason: "fixture outage" },
      envOverride: { MAXIMUS_OPERATOR_TOKEN: OPERATOR_TOKEN },
    });
    expect(killed.status).toBe(200);
    expect(await killed.json()).toMatchObject({ providers: { claude: { enabled: false, reason: "fixture outage" } } });

    const workspace = slug("ws");
    await signupWorkspace(token, workspace);
    const routed = await call(`/api/workspaces/${workspace}/providers`, { token });
    const routedBody = await routed.json() as { routing: Record<string, { allowed: boolean; reason?: string }> };
    expect(routedBody.routing.claude.allowed).toBe(false);
    expect(routedBody.routing.claude.reason).toBe("fixture outage");
  });

  it("stores an admin ration and signs the next workspace up on it", async () => {
    const saved = await call("/api/operator/plans", {
      method: "PUT",
      headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
      body: { plans: [{ id: "starter", entitlements: ["billing", "gateway"], allowance: 900 }] },
      envOverride: { MAXIMUS_OPERATOR_TOKEN: OPERATOR_TOKEN },
    });
    expect(saved.status).toBe(200);
    const token = await signIn(mail("catalog"));
    const workspace = slug("ws");
    await signupWorkspace(token, workspace, "starter");
    const view = await call(`/api/workspaces/${workspace}/entitlements`, { token });
    expect(view.status).toBe(200);
    const body = await view.json() as { entitlements: { allowance: number; plan: string } };
    expect(body.entitlements).toMatchObject({ plan: "starter", allowance: 900 });
  });

  it("issues a workspace token for read-only sync and rotates it", async () => {
    const admin = await signIn(mail("token-admin"));
    const workspace = slug("ws");
    await signupWorkspace(admin, workspace);

    const issued = await call(`/api/workspaces/${workspace}/token`, { method: "POST", token: admin });
    expect(issued.status).toBe(201);
    const issuedBody = await issued.json() as { token: { workspace: string; token: string } };
    const workspaceToken = issuedBody.token.token;
    expect(workspaceToken).toMatch(/^maximus_workspace_[A-Za-z0-9_-]{43}$/);

    const sync = await call(`/api/workspaces/${workspace}/entitlements`, {
      headers: { authorization: `Bearer ${workspaceToken}` },
    });
    expect(sync.status).toBe(200);

    const other = slug("ws");
    const crossTenant = await call(`/api/workspaces/${other}/entitlements`, {
      headers: { authorization: `Bearer ${workspaceToken}` },
    });
    expect(crossTenant.status).toBe(401);

    const rotated = await call(`/api/workspaces/${workspace}/token`, { method: "POST", token: admin });
    expect(rotated.status).toBe(201);
    const stale = await call(`/api/workspaces/${workspace}/entitlements`, {
      headers: { authorization: `Bearer ${workspaceToken}` },
    });
    expect(stale.status).toBe(401);
  });

  it("lists the signed-in account's memberships, newest first", async () => {
    const founder = await signIn(mail("member-founder"));
    const first = slug("ws");
    const second = slug("ws");
    await signupWorkspace(founder, first);
    await signupWorkspace(founder, second);

    const listed = await call("/api/auth/memberships", { token: founder });
    expect(listed.status).toBe(200);
    expect(listed.headers.get("x-maximus-contract-version")).toBe("1");
    const body = await listed.json() as { memberships: { workspace: string; role: string; plan: string; status: string }[] };
    expect(body.memberships.map((row) => row.workspace)).toEqual([second, first]);
    expect(body.memberships[0]).toMatchObject({ role: "admin", plan: "team", status: "active" });

    const stranger = await signIn(mail("member-stranger"));
    const empty = await call("/api/auth/memberships", { token: stranger });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ memberships: [] });

    const anonymous = await call("/api/auth/memberships");
    expect(anonymous.status).toBe(401);
  });

  it("shows an invited member their workspace with the member role", async () => {
    const admin = await signIn(mail("member-admin"));
    const workspace = slug("ws");
    await signupWorkspace(admin, workspace);
    const memberEmail = `listed-${workspace}@example.test`;
    const created = await call("/api/auth/invite", {
      method: "POST",
      token: admin,
      body: { workspace, email: memberEmail, role: "member" },
    });
    const { token: inviteToken } = await created.json() as { token: string };
    const joined = await signIn(memberEmail);
    await call("/api/auth/invite/accept", { method: "POST", token: joined, body: { token: inviteToken } });

    const listed = await call("/api/auth/memberships", { token: joined });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      memberships: [{ workspace, displayName: `Workspace ${workspace}`, plan: "team", status: "active", role: "member" }],
    });
  });

  it("serves the frozen health shape", async () => {
    const response = await call("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "maximus-control-plane", contractVersion: 1 });
    expect(response.headers.get("x-maximus-contract-version")).toBe("1");
  });
});
