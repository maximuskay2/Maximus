// Entitlement sync tests: pure plan/grace transitions plus billing-event
// application against fixture workspaces. No live billing provider.
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createAuth } from "../src/auth";
import { readConfig } from "../src/config";
import {
  PLAN_CATALOG,
  degradeExpiredGrace,
  describeEntitlementSync,
  entitlementView,
  grantedEntitlements,
  transitionForBillingEvent,
  type BillingEvent,
  type WorkspaceEntitlementState,
} from "../src/entitlements";
import worker from "../src/index";
import { applyBillingEvent } from "../src/workspaces";

const BASE_URL = "https://auth.maximus.test";
let serial = 3000;

function slug(prefix: string): string {
  serial += 1;
  return `${prefix}-${serial}-ent`.toLowerCase();
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

const ACTIVE: WorkspaceEntitlementState = {
  workspace: "acme",
  plan: "business",
  entitlements: ["admin", "gateway", "unshipped-future"],
  allowance: 100,
  status: "active",
  graceEndsAt: null,
};

function billingEvent(overrides: Partial<BillingEvent> & { workspace_id: string }): BillingEvent {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    type: "billing.checkout_completed",
    created_at: new Date().toISOString(),
    provider: "stripe",
    livemode: false,
    customer_id: "cus_fixture",
    plan: "business",
    entitlements: ["admin", "gateway"],
    allowance: 100,
    ...overrides,
  };
}

describe("entitlement transitions", () => {
  it("grants known ids only and carries unknown ones", () => {
    expect(grantedEntitlements(["admin", "nope", "gateway", "admin"])).toEqual(["admin", "gateway"]);
    expect(entitlementView(ACTIVE).granted).toEqual([
      "admin", "agentOsMachines", "billing", "budgets", "gateway", "sso", "whitelabel",
    ]);
    expect(entitlementView(ACTIVE).banner).toBeNull();
  });

  it("moves failures into grace and degrades to free at grace end", () => {
    const now = Date.now();
    const graced = transitionForBillingEvent(ACTIVE, billingEvent({ workspace_id: "acme", type: "billing.payment_failed" }), now);
    expect(graced.status).toBe("grace");
    expect(graced.graceEndsAt).toBe(now + 7 * 24 * 60 * 60_000);
    expect(graced.entitlements).toEqual(ACTIVE.entitlements);

    const repeat = transitionForBillingEvent(
      { ...ACTIVE, status: "grace", graceEndsAt: graced.graceEndsAt },
      billingEvent({ workspace_id: "acme", type: "billing.subscription_cancelled" }),
      now + 1000,
    );
    expect(repeat.changed).toBe(false);
    expect(repeat.graceEndsAt).toBe(graced.graceEndsAt);

    const banner = entitlementView({ ...ACTIVE, status: "grace", graceEndsAt: graced.graceEndsAt }, now);
    expect(banner.banner?.kind).toBe("grace");

    const degraded = degradeExpiredGrace({ ...ACTIVE, status: "grace", graceEndsAt: graced.graceEndsAt }, graced.graceEndsAt! + 1);
    expect(degraded).toMatchObject({ status: "suspended", entitlements: [], allowance: null, degraded: true });
    const suspended = entitlementView({ ...ACTIVE, ...degraded, status: "suspended", graceEndsAt: graced.graceEndsAt });
    expect(suspended.banner?.kind).toBe("suspended");
    expect(describeEntitlementSync(suspended)).toContain("acme");
  });

  it("keeps a Muse ration checkout on that plan", () => {
    const floor: WorkspaceEntitlementState = { ...ACTIVE, plan: "free", entitlements: [], allowance: null };
    const starter = transitionForBillingEvent(
      floor,
      billingEvent({ workspace_id: "acme", plan: "starter", entitlements: [], allowance: null }),
    );
    expect(starter).toMatchObject({ plan: "starter", allowance: 8_00, entitlements: ["billing", "gateway", "agentOsMachines"], status: "active" });
    expect(PLAN_CATALOG.byo.entitlements).toContain("agentOsMachines");
    expect(PLAN_CATALOG.free.entitlements).not.toContain("agentOsMachines");
    expect(PLAN_CATALOG.team).toMatchObject({ allowance: 22_00 });
    expect(PLAN_CATALOG.team.entitlements).toContain("gateway");
    expect(PLAN_CATALOG.business.allowance).toBe(40_00);
    const ignored = transitionForBillingEvent(
      floor,
      billingEvent({ workspace_id: "acme", plan: "nope", entitlements: [], allowance: null }),
    );
    expect(ignored.plan).toBe("free");
  });

  it("recovers on payment and re-seeds changed plans", () => {
    const graced: WorkspaceEntitlementState = { ...ACTIVE, status: "grace", graceEndsAt: Date.now() + 1000 };
    const recovered = transitionForBillingEvent(
      graced,
      billingEvent({ workspace_id: "acme", type: "billing.payment_recovered", plan: "team", entitlements: [], allowance: null }),
    );
    expect(recovered).toMatchObject({ status: "active", plan: "team", graceEndsAt: null });
    expect(recovered.entitlements).toContain("budgets");
  });
});

describe("billing event application", () => {
  it("applies events idempotently and degrades expired grace on read", async () => {
    const admin = await signIn(`ent-admin-${serial}@example.test`);
    const workspace = slug("ws");
    await call("/api/auth/signup", { method: "POST", token: admin, body: { workspace, plan: "business" } });

    const event = billingEvent({ workspace_id: workspace, type: "billing.payment_failed", event_id: "evt-fixture-1" });
    const first = await applyBillingEvent(env, event);
    expect(first.applied).toBe(true);
    expect(first.view.banner?.kind).toBe("grace");
    const replay = await applyBillingEvent(env, event);
    expect(replay.applied).toBe(false);

    // Grace expiry degrades on the next entitlements read, without a restart.
    await env.DB.prepare("UPDATE workspaces SET grace_ends_at = ? WHERE id = ?").bind(Date.now() - 1, workspace).run();
    const response = await call(`/api/workspaces/${workspace}/entitlements`, { token: admin });
    expect(response.status).toBe(200);
    const body = await response.json() as { entitlements: { granted: string[]; banner: { kind: string } | null } };
    expect(body.entitlements.granted).toEqual([]);
    expect(body.entitlements.banner?.kind).toBe("suspended");

    const spend = await call(`/api/workspaces/${workspace}/spend`, { token: admin });
    expect(spend.status).toBe(200);
    const spendBody = await spend.json() as { spend: { spent: number; allowance: number | null } };
    expect(spendBody.spend.spent).toBe(0);
  });
});
