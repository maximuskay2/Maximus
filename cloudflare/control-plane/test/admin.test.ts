// Admin console tests: seats, installations, audit, usage and routing views
// against isolated fixture workspaces.
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createAuth } from "../src/auth";
import { readConfig } from "../src/config";
import worker from "../src/index";

const BASE_URL = "https://auth.maximus.test";
let serial = 2000;

function slug(prefix: string): string {
  serial += 1;
  return `${prefix}-${serial}-adm`.toLowerCase();
}

async function call(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const headers = new Headers();
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const request = new Request(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
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

describe("admin console", () => {
  it("serves seats, audit, usage and routing to workspace admins only", async () => {
    const admin = await signIn(`adm-admin-${serial}@example.test`);
    const memberEmail = `adm-member-${serial}@example.test`;
    const workspace = slug("ws");
    await call("/api/auth/signup", { method: "POST", token: admin, body: { workspace, plan: "business" } });

    const invited = await call("/api/auth/invite", {
      method: "POST",
      token: admin,
      body: { workspace, email: memberEmail, role: "member" },
    });
    const { token: inviteToken } = await invited.json() as { token: string };
    const member = await signIn(memberEmail);
    await call("/api/auth/invite/accept", { method: "POST", token: member, body: { token: inviteToken } });

    const seats = await call(`/api/admin/seats?workspace=${workspace}`, { token: admin });
    expect(seats.status).toBe(200);
    const seatsBody = await seats.json() as { seats: { admins: number; members: number; pendingInvites: number } };
    expect(seatsBody.seats).toMatchObject({ admins: 1, members: 1, pendingInvites: 0 });

    const memberSeats = await call(`/api/admin/seats?workspace=${workspace}`, { token: member });
    expect(memberSeats.status).toBe(403);

    const audit = await call(`/api/admin/audit?workspace=${workspace}`, { token: admin });
    expect(audit.status).toBe(200);
    const auditBody = await audit.json() as { audit: { entries: { action: string }[] } };
    const actions = auditBody.audit.entries.map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(["workspace.created", "member.invited", "member.joined"]));

    const usage = await call(`/api/admin/usage?workspace=${workspace}`, { token: admin });
    expect(usage.status).toBe(200);
    const usageBody = await usage.json() as {
      usage: { entitlements: { plan: string; granted: string[] }; spend: { spent: number; allowance: number | null } };
    };
    expect(usageBody.usage.entitlements.plan).toBe("business");
    expect(usageBody.usage.entitlements.granted).toContain("gateway");
    expect(usageBody.usage.spend.spent).toBe(0);

    await call(`/api/workspaces/${workspace}/providers`, {
      method: "PUT",
      token: admin,
      body: { kimi: { mode: "bundled", models: ["kimi-k3.1-pro"] }, grok: { mode: "off" } },
    });
    const routing = await call(`/api/admin/routing?workspace=${workspace}`, { token: admin });
    expect(routing.status).toBe(200);
    const routingBody = await routing.json() as { routing: { providers: Record<string, { via: string }> } };
    expect(routingBody.routing.providers.kimi.via).toBe("bundled");
    expect(routingBody.routing.providers.grok.via).toBe("off");
    expect(routingBody.routing.providers.claude.via).toBe("byo");

    const memberRouting = await call(`/api/admin/routing?workspace=${workspace}`, { token: member });
    expect(memberRouting.status).toBe(403);
  });

  it("lists member installations and validates audit limits", async () => {
    const admin = await signIn(`adm-inst-${serial}@example.test`);
    const workspace = slug("ws");
    await call("/api/auth/signup", { method: "POST", token: admin, body: { workspace } });

    const created = await call("/v1/installations", {
      method: "POST",
      token: admin,
      body: { clientInstanceId: crypto.randomUUID(), name: "Admin Mac", platform: "darwin" },
    });
    expect(created.status).toBe(201);

    const installations = await call(`/api/admin/installations?workspace=${workspace}`, { token: admin });
    expect(installations.status).toBe(200);
    const installationsBody = await installations.json() as { installations: { count: number; installations: { name: string }[] } };
    expect(installationsBody.installations.count).toBe(1);
    expect(installationsBody.installations.installations[0].name).toBe("Admin Mac");

    const badLimit = await call(`/api/admin/audit?workspace=${workspace}&limit=500`, { token: admin });
    expect(badLimit.status).toBe(400);
    const missingWorkspace = await call("/api/admin/seats", { token: admin });
    expect(missingWorkspace.status).toBe(400);
  });
});
