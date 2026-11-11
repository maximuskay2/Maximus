import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ConsoleError,
  consolePlans,
  createAccountStore,
  createWorkspace,
  formatUsd,
  myMemberships,
  normalizeConsoleEmail,
  planPriceLine,
  rememberedWorkspace,
  rememberWorkspace,
  setWorkspaceProvider,
  setWorkspaceProviders,
  socialAccountFromHash,
  startOtp,
  toProviderStates,
  validConsoleEmail,
  validOtpCode,
  validWorkspaceId,
  verifyOtp,
  workspaceProviders,
  type ConsolePlanView,
} from "./account";
import { AdminView, toAdminRouting, toAuditViews, toInstallationViews, toSpendHistory, type AdminDashboard } from "./AdminPage";
import { inviteTokenFromLocation, JoinView } from "./JoinPage";
import { signinNextPath, SigninView } from "./SigninPage";
import { planAllowanceLine, planFeatureUnion, planHref, planPriceLine as pricingPriceLine, PricingView } from "./PricingPage";
import { SignupView } from "./SignupPage";

function stubFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
}

const FREE_PLAN: ConsolePlanView = {
  id: "free",
  name: "Free",
  blurb: "",
  baseUsd: 0,
  allowanceUsd: 0,
  hardCapUsd: null,
  entitlements: [],
  features: ["BYO logins"],
};

describe("console validation", () => {
  it("accepts shaped emails, workspace ids, and codes", () => {
    expect(validConsoleEmail("Ada@Example.com")).toBe(true);
    expect(validConsoleEmail("nope")).toBe(false);
    expect(normalizeConsoleEmail(" Ada@Example.com ")).toBe("ada@example.com");
    expect(validWorkspaceId("acme-1")).toBe(true);
    expect(validWorkspaceId("Acme")).toBe(false);
    expect(validWorkspaceId("x")).toBe(false);
    expect(validOtpCode("12345678")).toBe(true);
    expect(validOtpCode("1234")).toBe(false);
  });

  it("keeps the account token in its own store", () => {
    const backing = new Map<string, string>();
    const store = createAccountStore({
      getItem: (key) => backing.get(key) ?? null,
      setItem: (key, value) => {
        backing.set(key, value);
      },
      removeItem: (key) => {
        backing.delete(key);
      },
    });
    expect(store.load()).toBeNull();
    store.save({ token: "tok", email: "ada@example.com" });
    expect(store.load()).toEqual({ token: "tok", email: "ada@example.com" });
    store.clear();
    expect(store.load()).toBeNull();
    backing.set("maximus.console.account", "not json");
    expect(store.load()).toBeNull();
  });

  it("reads invite tokens from either query key", () => {
    expect(inviteTokenFromLocation("?token=" + "a".repeat(43))).toBe("a".repeat(43));
    expect(inviteTokenFromLocation("?invite=" + "b".repeat(43))).toBe("b".repeat(43));
    expect(inviteTokenFromLocation("?token=short")).toBeNull();
    expect(inviteTokenFromLocation("")).toBeNull();
  });
});

describe("console api client", () => {
  it("sends OTP start and verify with JSON bodies", async () => {
    const fetchImpl = stubFetch((url) => {
      if (url.endsWith("/otp/start")) return { status: 200, body: { ok: true, email: "ada@example.com" } };
      return { status: 200, body: { token: "tok", user: { id: "u1", email: "ada@example.com" } } };
    });
    await expect(startOtp("ada@example.com", { fetchImpl })).resolves.toEqual({ ok: true, email: "ada@example.com" });
    await expect(verifyOtp("ada@example.com", "12345678", { fetchImpl })).resolves.toMatchObject({ token: "tok" });
    const [, init] = fetchImpl.mock.calls[1]!;
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ email: "ada@example.com", code: "12345678" });
  });

  it("carries the bearer token on workspace calls and surfaces server errors", async () => {
    const fetchImpl = stubFetch(() => ({ status: 409, body: { error: "That workspace name is taken.", code: "conflict" } }));
    const failure = await createWorkspace("tok", { workspace: "acme" }, { fetchImpl }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConsoleError);
    expect(failure).toMatchObject({ status: 409, code: "conflict", message: "That workspace name is taken." });
    const [, init] = fetchImpl.mock.calls[0]!;
    if (!init) throw new Error("expected the workspace call to reach fetch");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("reads the public plan catalog", async () => {
    const fetchImpl = stubFetch(() => ({ status: 200, body: { plans: [FREE_PLAN] } }));
    await expect(consolePlans({ fetchImpl })).resolves.toEqual({ plans: [FREE_PLAN] });
  });

  it("normalizes the provider record into a stable array with routing reasons", async () => {
    const fetchImpl = stubFetch(() => ({
      status: 200,
      body: {
        workspace: "acme",
        providers: {
          kimi: { mode: "off", models: [] },
          claude: { mode: "byo", models: [] },
          "Nope!": { mode: "byo", models: [] },
        },
        routing: {
          kimi: { allowed: false, via: "off", reason: "kimi is turned off for this workspace." },
          claude: { allowed: true, via: "byo" },
        },
      },
    }));
    const { providers, routing } = await workspaceProviders("tok", "acme", { fetchImpl });
    expect(providers).toEqual([
      { id: "claude", mode: "byo", models: [] },
      { id: "kimi", mode: "off", models: [], reason: "kimi is turned off for this workspace." },
    ]);
    expect(routing.kimi).toMatchObject({ allowed: false, via: "off" });
    expect(routing.claude).toMatchObject({ allowed: true, via: "byo" });
  });

  it("sends provider updates as the worker's id-keyed record", async () => {
    const fetchImpl = stubFetch(() => ({ status: 200, body: { workspace: "acme", providers: { kimi: { mode: "off", models: [] } } } }));
    const { providers, routing } = await setWorkspaceProviders("tok", "acme", { kimi: { mode: "off" } }, { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({ kimi: { mode: "off" } });
    expect(providers).toEqual([{ id: "kimi", mode: "off", models: [] }]);
    expect(routing).toEqual({});
    await setWorkspaceProvider("tok", "acme", "kimi", { mode: "byo" }, { fetchImpl });
    const [url, single] = fetchImpl.mock.calls[1]!;
    expect(url).toBe("/api/console/workspaces/acme/providers/kimi");
    expect(JSON.parse(String(single?.body))).toEqual({ mode: "byo" });
  });

  it("lists memberships and drops malformed rows", async () => {
    const fetchImpl = stubFetch(() => ({
      status: 200,
      body: { memberships: [{ workspace: "acme", displayName: "Acme", plan: "team", status: "active", role: "admin" }, { workspace: "Nope!" }, null] },
    }));
    await expect(myMemberships("tok", { fetchImpl })).resolves.toEqual({
      memberships: [{ workspace: "acme", displayName: "Acme", plan: "team", status: "active", role: "admin" }],
    });
  });

  it("remembers the last workspace id only when it is shaped", () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => {
        backing.set(key, value);
      },
    };
    expect(rememberedWorkspace(storage)).toBe("");
    rememberWorkspace("acme-1", storage);
    expect(rememberedWorkspace(storage)).toBe("acme-1");
    rememberWorkspace("Nope!", storage);
    expect(rememberedWorkspace(storage)).toBe("acme-1");
    backing.set("maximus.console.workspace", "junk!!");
    expect(rememberedWorkspace(storage)).toBe("");
  });

  it("keeps signin redirects on same-origin app paths", () => {
    expect(signinNextPath("/admin")).toBe("/admin");
    expect(signinNextPath("/")).toBe("/");
    expect(signinNextPath("https://evil.test/admin")).toBe("/admin");
    expect(signinNextPath("//evil.test")).toBe("/admin");
    expect(signinNextPath(null)).toBe("/admin");
  });

  it("normalizes admin views and drops malformed rows", () => {
    expect(toProviderStates(null)).toEqual({ providers: [], routing: {} });
    expect(toInstallationViews({ installations: { installations: [{ id: "i1", name: "Desk", platform: "darwin", appVersion: "0.1.144", ownerEmail: "a@b.co", createdAt: 7, lastSeenAt: 9 }, null] } }))
      .toEqual([{ id: "i1", name: "Desk", platform: "darwin", appVersion: "0.1.144", ownerEmail: "a@b.co", createdAt: 7, lastSeenAt: 9 }]);
    expect(toAuditViews({ audit: { entries: [{ id: "e1", actor: "a@b.co", action: "member.invited", createdAt: 7 }, {}] } }))
      .toEqual([{ id: "e1", actor: "a@b.co", action: "member.invited", createdAt: 7 }]);
    expect(toSpendHistory({ usage: { history: [{ period: "2026-11", amount: 250 }, { period: "x" }] } }))
      .toEqual([{ period: "2026-11", amount: 250 }]);
    expect(toAdminRouting({ routing: { providers: { kimi: { allowed: false, via: "off", operatorEnabled: true, workspaceMode: "off", reason: "off" }, "No!": {} } } }))
      .toEqual([{ id: "kimi", allowed: false, via: "off", operatorEnabled: true, workspaceMode: "off", reason: "off" }]);
  });
});

describe("console plan display", () => {
  it("prices free at zero and paid by the month", () => {
    expect(formatUsd(20)).toBe("$20");
    expect(planPriceLine(FREE_PLAN)).toBe("Free");
    expect(planPriceLine({ ...FREE_PLAN, baseUsd: 20 })).toBe("$20/mo");
    expect(pricingPriceLine(FREE_PLAN)).toBe("Free");
    const plus = { ...FREE_PLAN, id: "plus", name: "Plus", baseUsd: 19 };
    const nigeria = { currency: "NGN" as const, provider: "paystack" as const, paystackEnabled: true, ngnPerUsd: 1600 };
    expect(pricingPriceLine(plus, nigeria)).toBe("₦30,400/mo");
    const naira = renderToStaticMarkup(createElement(PricingView, { plans: [FREE_PLAN, plus], error: null, offer: nigeria }));
    expect(naira).toContain("₦30,400/mo");
    expect(naira).toContain("Prices in Naira, billed monthly with Paystack.");
  });
});

const noop = (): void => undefined;

describe("console views", () => {
  it("renders each signup step", () => {
    const base = {
      email: "",
      code: "",
      workspaceId: "",
      displayName: "",
      plan: "free",
      plans: [FREE_PLAN],
      created: null,
      busy: false,
      error: null,
      onEmail: noop,
      onCode: noop,
      onWorkspaceId: noop,
      onDisplayName: noop,
      onPlan: noop,
      onSendCode: noop,
      onVerifyCode: noop,
      onCreate: noop,
      onBackToEmail: noop,
    };
    const email = renderToStaticMarkup(createElement(SignupView, { ...base, step: "email" }));
    expect(email).toContain("console-signup-email");
    const code = renderToStaticMarkup(createElement(SignupView, { ...base, step: "code", email: "ada@example.com" }));
    expect(code).toContain("ada@example.com");
    const workspace = renderToStaticMarkup(createElement(SignupView, { ...base, step: "workspace" }));
    expect(workspace).toContain("console-signup-workspace");
    const done = renderToStaticMarkup(createElement(SignupView, {
      ...base,
      step: "done",
      created: { id: "acme", displayName: "Acme", plan: "free", role: "admin", status: "active" },
    }));
    expect(done).toContain("acme");
  });

  it("renders join states and pricing rows", () => {
    const join = renderToStaticMarkup(createElement(JoinView, {
      step: "email",
      email: "",
      code: "",
      joined: null,
      busy: false,
      error: null,
      onEmail: noop,
      onCode: noop,
      onSendCode: noop,
      onVerifyCode: noop,
      onBackToEmail: noop,
    }));
    expect(join).toContain("console-join-email");
    const pricing = renderToStaticMarkup(createElement(PricingView, { plans: [FREE_PLAN], error: null }));
    expect(pricing).toContain("Free");
    expect(pricing).toContain("/signup");
    expect(pricing).toContain("Browser");
    expect(pricing).toContain("Enterprise");
    expect(pricing).toContain('href="/signin"');
    expect(planHref("free", false)).toBe("/signup");
    expect(planHref("starter", false)).toBe("/signup?plan=starter");
    expect(planHref("starter", true)).toBe("/");
    const signed = renderToStaticMarkup(createElement(PricingView, { plans: [FREE_PLAN], error: null, signedIn: true, person: "ada@example.com" }));
    expect(signed).toContain("ada@example.com");
    expect(signed).toContain('href="/"');
    const loading = renderToStaticMarkup(createElement(PricingView, { plans: null, error: null }));
    expect(loading).not.toContain("<table");
    expect(planAllowanceLine(FREE_PLAN)).toContain("own model logins");
    expect(planAllowanceLine({ ...FREE_PLAN, allowanceUsd: 0.012 })).toContain("$0.012 of Muse, once");
    const team: ConsolePlanView = { ...FREE_PLAN, id: "team", name: "Team", baseUsd: 20, allowanceUsd: 20, features: ["Shared rooms", "Admin dashboard"] };
    const compare = renderToStaticMarkup(createElement(PricingView, { plans: [FREE_PLAN, team], error: null }));
    expect(compare).toContain("compare-heading");
    expect(compare).toContain("Shared rooms");
    expect(compare).toContain("Most popular");
    expect(compare).toContain("<details");
    expect(planFeatureUnion([FREE_PLAN, team])).toEqual([...FREE_PLAN.features, "Shared rooms", "Admin dashboard"]);
  });

  it("renders each signin step", () => {
    const base = {
      email: "",
      code: "",
      memberships: [],
      busy: false,
      error: null,
      onEmail: noop,
      onCode: noop,
      onSendCode: noop,
      onVerifyCode: noop,
      onBackToEmail: noop,
      onPick: noop,
    };
    expect(renderToStaticMarkup(createElement(SigninView, { ...base, step: "email" }))).toContain("console-signin-email");
    expect(renderToStaticMarkup(createElement(SigninView, {
      ...base,
      step: "email",
      providers: [{ id: "github", label: "GitHub" }, { id: "email", label: "Email" }],
    }))).toContain("Continue with GitHub");
    expect(socialAccountFromHash("#account=signed.token&email=Ada@Example.com")).toEqual({ token: "signed.token", email: "ada@example.com" });
    expect(socialAccountFromHash("#email=ada@example.com")).toBeNull();
    expect(renderToStaticMarkup(createElement(SigninView, { ...base, step: "code", email: "ada@example.com" }))).toContain("console-signin-code");
    const picker = renderToStaticMarkup(createElement(SigninView, {
      ...base,
      step: "workspace",
      memberships: [{ workspace: "acme", displayName: "Acme", plan: "team", status: "active", role: "admin" }],
    }));
    expect(picker).toContain("Acme");
    expect(renderToStaticMarkup(createElement(SigninView, { ...base, step: "workspace" }))).toContain("/signup");
  });

  it("never mentions admin in public account copy", () => {
    const signupBase = {
      email: "", code: "", workspaceId: "", displayName: "", plan: "free", plans: [FREE_PLAN],
      created: null, busy: false, error: null, onEmail: noop, onCode: noop, onWorkspaceId: noop,
      onDisplayName: noop, onPlan: noop, onSendCode: noop, onVerifyCode: noop, onCreate: noop, onBackToEmail: noop,
    };
    const joinBase = {
      email: "", code: "", joined: null, busy: false, error: null,
      onEmail: noop, onCode: noop, onSendCode: noop, onVerifyCode: noop, onBackToEmail: noop,
    };
    const signinBase = {
      email: "", code: "", memberships: [], busy: false, error: null,
      onEmail: noop, onCode: noop, onSendCode: noop, onVerifyCode: noop, onBackToEmail: noop, onPick: noop,
    };
    const team: ConsolePlanView = { ...FREE_PLAN, id: "team", name: "Team", baseUsd: 20, allowanceUsd: 20, features: ["Shared rooms"] };
    const acme = { id: "acme", displayName: "Acme", plan: "team", role: "admin", status: "active" } as const;
    const pages = [
      renderToStaticMarkup(createElement(SignupView, { ...signupBase, step: "email" })),
      renderToStaticMarkup(createElement(SignupView, { ...signupBase, step: "code", email: "ada@example.com" })),
      renderToStaticMarkup(createElement(SignupView, { ...signupBase, step: "workspace" })),
      renderToStaticMarkup(createElement(SignupView, { ...signupBase, step: "done", created: { ...acme } })),
      renderToStaticMarkup(createElement(JoinView, { ...joinBase, step: "email" })),
      renderToStaticMarkup(createElement(JoinView, { ...joinBase, step: "done", joined: { ...acme } })),
      renderToStaticMarkup(createElement(SigninView, { ...signinBase, step: "email" })),
      renderToStaticMarkup(createElement(SigninView, { ...signinBase, step: "code", email: "ada@example.com" })),
      renderToStaticMarkup(createElement(SigninView, {
        ...signinBase, step: "workspace", memberships: [{ workspace: "acme", displayName: "Acme", plan: "team", status: "active", role: "admin" }],
      })),
      renderToStaticMarkup(createElement(PricingView, { plans: [FREE_PLAN, team], error: null })),
    ];
    expect(pages[8]).toContain("Owner");
    for (const page of pages) {
      expect(page.replace(/<[^>]*>/g, " ")).not.toMatch(/admin/i);
    }
  });

  it("renders the admin dashboard, the member limit, and the signed-out prompt", () => {
    const dashboard: AdminDashboard = {
      email: "ada@example.com",
      memberships: [{ workspace: "acme", displayName: "Acme", plan: "team", status: "active", role: "admin" }],
      workspaceId: "acme",
      workspace: { id: "acme", displayName: "Acme", plan: "team", role: "admin", status: "active" },
      entitlements: { plan: "team", granted: ["admin"], status: "active", banner: null },
      spend: { period: "2026-11", spent: 250, allowance: 2000, remaining: 1750, overage: 0 },
      history: [{ period: "2026-11", amount: 250 }],
      providers: [{ id: "kimi", mode: "off", models: [] }],
      members: [{ userId: "u1", email: "ada@example.com", name: "Ada", role: "admin" }],
      invites: [],
      installations: [{ id: "i1", name: "Desk", platform: "darwin", appVersion: "0.1.144", ownerEmail: "ada@example.com", createdAt: 7, lastSeenAt: null }],
      audit: [{ id: "e1", actor: "ada@example.com", action: "member.invited", createdAt: 7 }],
      routing: [{ id: "kimi", allowed: false, via: "off", operatorEnabled: true, workspaceMode: "off", reason: "off" }],
      plans: [FREE_PLAN],
    };
    const base = {
      loading: false,
      inviteEmail: "",
      inviteRole: "member" as const,
      inviteLink: null,
      busy: false,
      error: null,
      onWorkspace: noop,
      onSignOut: noop,
      onMode: noop,
      onInviteEmail: noop,
      onInviteRole: noop,
      onSendInvite: noop,
      onRevokeUser: noop,
      onRevokeInvite: noop,
    };
    const admin = renderToStaticMarkup(createElement(AdminView, { ...base, signedIn: true, dashboard }));
    expect(admin).toContain("ada@example.com");
    expect(admin).toContain("console-admin-invite-email");
    expect(admin).toContain("member.invited");
    expect(admin).toContain("2026-11");
    const member = renderToStaticMarkup(createElement(AdminView, {
      ...base,
      signedIn: true,
      dashboard: { ...dashboard, workspace: { ...dashboard.workspace!, role: "member" }, members: [], invites: [], installations: [], audit: [], routing: [], history: [] },
    }));
    expect(member).not.toContain("console-admin-invite-email");
    expect(member).toContain("kimi");
    expect(renderToStaticMarkup(createElement(AdminView, { ...base, signedIn: false, dashboard: null }))).toContain("/signin?next=/admin");
    expect(renderToStaticMarkup(createElement(AdminView, { ...base, signedIn: true, loading: true, dashboard: null }))).not.toContain("console-admin-invite-email");
  });
});
