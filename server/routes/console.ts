// Public console API: hosted signup, invites, workspaces, provider toggles,
// admin reads, and the plan catalog. Pre-auth by design — the browser holds a
// control-plane account token (email OTP), never a harness session — so this
// runs before the auth gate in server/index.ts with module-internal matching.
// The control plane enforces workspace roles; this layer only forwards the
// bearer, maps errors, and serves the local plan catalog. Amounts come from
// operator configuration (MAXIMUS_BILLING_PLANS), never code.
import type { IncomingMessage, ServerResponse } from "node:http";

import { resolveCompanionControlPlaneURL } from "../../electron/companion-account-service.mjs";
import {
  ControlPlaneError,
  createControlPlaneClient,
  normalizeAccountEmail,
  type ControlPlaneClient,
} from "../../electron/control-plane-client.mjs";
import { planCatalogFromEnv, type BundledPlan } from "../billing/plans.ts";
import type { PlanDisplayView } from "../billing/plan-store.ts";
import { requestOrigin } from "../request-auth.ts";

export interface ConsoleRouteDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  client?: ControlPlaneClient;
  controlPlaneURL?: string;
  settingsURL?: () => string;
  plans?: ReadonlyMap<string, BundledPlan>;
  displays?: ReadonlyMap<string, PlanDisplayView>;
}

type Json = (res: ServerResponse, status: number, body: unknown) => void;
type ReadBody = (req: IncomingMessage, limit?: number) => Promise<unknown>;

const WORKSPACE_ID = /^[a-z][a-z0-9-]{1,30}$/;
const PROVIDER_IDS = ["claude", "codex", "grok", "kimi", "muse"] as const;
const ADMIN_VIEWS = ["seats", "installations", "audit", "usage", "routing"] as const;
const BODY_LIMIT = 8192;

const ENTITLEMENT_NAMES: Readonly<Record<string, string>> = {
  whitelabel: "White label",
  sso: "Single sign-on (SSO)",
  admin: "Admin console",
  budgets: "Spend caps",
  billing: "Billable usage",
  gateway: "Bundled models",
  agentOsMachines: "Agent OS on this computer and named computers",
};

interface PlanDisplay {
  name: string;
  blurb: string;
  features: string[];
}

const PLAN_DISPLAY: Readonly<Record<string, PlanDisplay>> = {
  free: {
    name: "Free",
    blurb: "Your own models, on your own machine.",
    features: [
      "Web, desktop, and phone",
      "Bring your own Claude, ChatGPT, Grok, Kimi and Muse logins",
      "Local-first: data stays on your machine",
      "Approval cards for risky actions",
    ],
  },
  team: {
    name: "Team",
    blurb: "Hosted workspaces with admin controls.",
    features: ["Web, desktop, and phone", "Everything in Free", "Named computers on this plan", "Hosted workspaces with team invites", "Admin console, spend caps and billable usage"],
  },
  business: {
    name: "Business",
    blurb: "Bundled models and organization controls.",
    features: ["Web, desktop, and phone", "Everything in Team", "LLM-included usage with monthly allowance", "SSO and white label"],
  },
};

export interface ConsolePlanView {
  id: string;
  name: string;
  blurb: string;
  baseUsd: number;
  allowanceUsd: number;
  hardCapUsd: number | null;
  entitlements: string[];
  features: string[];
}

export function planCatalogView(plans: ReadonlyMap<string, BundledPlan>, displays: ReadonlyMap<string, PlanDisplayView> = new Map()): ConsolePlanView[] {
  const free = displays.get("free") ?? PLAN_DISPLAY.free;
  const freePricing = plans.get("free");
  const views: ConsolePlanView[] = [{
    id: "free",
    name: free.name,
    blurb: free.blurb,
    baseUsd: freePricing?.baseUsd ?? 0,
    allowanceUsd: freePricing?.allowanceUsd ?? 0,
    hardCapUsd: freePricing?.hardCapUsd ?? null,
    entitlements: freePricing ? [...freePricing.entitlements] : [],
    features: [...free.features],
  }];
  for (const plan of plans.values()) {
    if (plan.id === "free") continue;
    const display = displays.get(plan.id) ?? PLAN_DISPLAY[plan.id] ?? {
      name: plan.id,
      blurb: "",
      features: plan.entitlements.map((id) => ENTITLEMENT_NAMES[id] ?? id),
    };
    views.push({
      id: plan.id,
      name: display.name,
      blurb: display.blurb,
      baseUsd: plan.baseUsd,
      allowanceUsd: plan.allowanceUsd,
      hardCapUsd: plan.hardCapUsd,
      entitlements: [...plan.entitlements],
      features: [...display.features],
    });
  }
  return views;
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  return value?.match(/^Bearer\s+(\S+)$/)?.[1] ?? null;
}

function queryWorkspace(req: IncomingMessage): string | null {
  const raw = typeof req.url === "string" ? req.url : "";
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "";
  const workspace = new URLSearchParams(query).get("workspace") ?? "";
  return WORKSPACE_ID.test(workspace) ? workspace : null;
}

function consoleError(error: unknown): { status: number; body: Record<string, string> } {
  if (error instanceof ControlPlaneError) {
    switch (error.code) {
      case "signed_out":
      case "unauthorized":
        return { status: 401, body: { error: "Sign in again to continue.", code: error.code } };
      case "forbidden":
        return { status: 403, body: { error: "Only a workspace admin can do this.", code: error.code } };
      case "not_found":
        return { status: 404, body: { error: "Not found. The link may have expired.", code: error.code } };
      case "conflict":
        return { status: 409, body: { error: "That workspace name is taken.", code: error.code } };
      case "rate_limited":
        return { status: 429, body: { error: "Too many attempts. Try again shortly.", code: error.code } };
      case "invalid_email":
      case "invalid_request":
        return { status: 400, body: { error: "Check the details and try again.", code: error.code } };
      case "invalid_otp":
        return error.status
          ? { status: 401, body: { error: "Wrong or expired code.", code: error.code } }
          : { status: 400, body: { error: "That code does not look right.", code: error.code } };
      default:
        return { status: 502, body: { error: "The account service is unreachable. Try again shortly.", code: "console_unavailable" } };
    }
  }
  return { status: 502, body: { error: "The account service is unreachable. Try again shortly.", code: "console_unavailable" } };
}

export function createConsolePublicRoutes(deps: ConsoleRouteDeps = {}): (
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  json: Json,
  readBody: ReadBody,
) => Promise<boolean> {
  const env = deps.env ?? process.env;
  const plans = deps.plans ?? planCatalogFromEnv(env);
  const displays = deps.displays ?? new Map<string, PlanDisplayView>();
  let client: ControlPlaneClient | null = deps.client ?? null;
  let clientURL = deps.controlPlaneURL ?? "";
  const controlPlane = (): ControlPlaneClient | null => {
    const url = deps.controlPlaneURL ?? resolveCompanionControlPlaneURL({ isPackaged: true, environment: env, configuredURL: deps.settingsURL?.() ?? "" });
    if (!url) return null;
    if (client && (clientURL === url || deps.client !== undefined)) return client;
    try {
      client = createControlPlaneClient({ baseURL: url, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) });
      clientURL = url;
    } catch {
      return null;
    }
    return client;
  };
  const unavailable = (res: ServerResponse, json: Json): true => {
    json(res, 503, { error: "Hosted signup is not configured on this server.", code: "console_unavailable" });
    return true;
  };

  return async (req, res, path, method, json, readBody): Promise<boolean> => {
    if (method === "GET" && path === "/api/console/plans") {
      res.setHeader("cache-control", "no-store");
      json(res, 200, { plans: planCatalogView(plans, displays) });
      return true;
    }
    const otpStart = method === "POST" && path === "/api/console/auth/otp/start";
    const otpVerify = method === "POST" && path === "/api/console/auth/otp/verify";
    const authMethods = method === "GET" && path === "/api/console/auth/methods";
    const socialStart = method === "POST" && path === "/api/console/auth/social";
    const signup = method === "POST" && path === "/api/console/workspaces";
    const inviteSend = method === "POST" && path === "/api/console/invites";
    const inviteAccept = method === "POST" && path === "/api/console/invites/accept";
    const inviteRevoke = method === "POST" && path === "/api/console/invites/revoke";
    const memberships = method === "GET" && path === "/api/console/memberships";
    const workspaceMatch = /^\/api\/console\/workspaces\/([a-z][a-z0-9-]{1,30})(\/providers(?:\/([a-z]+))?|\/entitlements|\/spend)?$/.exec(method === "GET" || method === "PUT" ? path : "");
    const adminMatch = method === "GET" ? /^\/api\/console\/admin\/(seats|installations|audit|usage|routing)$/.exec(path) : null;
    const storeVerify = method === "POST" && path === "/api/console/billing/store/verify";
    const storeStatus = method === "GET" && path === "/api/console/billing/store/status";
    if (!otpStart && !otpVerify && !authMethods && !socialStart && !signup && !inviteSend && !inviteAccept && !inviteRevoke && !memberships && !workspaceMatch && !adminMatch && !storeVerify && !storeStatus) return false;

    const api = controlPlane();
    if (!api) return unavailable(res, json);
    const noStore = () => res.setHeader("cache-control", "no-store");
    try {
      if (otpStart || otpVerify) {
        const body = (await readBody(req, BODY_LIMIT).catch(() => null)) as Record<string, unknown> | null;
        const email = normalizeAccountEmail(body && typeof body === "object" ? body.email : null);
        if (!email) {
          noStore();
          json(res, 400, { error: "Enter a valid email address.", code: "invalid_email" });
          return true;
        }
        if (otpStart) {
          await api.requestOTP(email);
          noStore();
          json(res, 200, { ok: true, email });
          return true;
        }
        const code = body && typeof body.code === "string" ? body.code : "";
        const verified = await api.verifyOTP(email, code);
        noStore();
        json(res, 200, { token: verified.accountToken, user: verified.user });
        return true;
      }
      if (authMethods) {
        noStore();
        json(res, 200, { methods: await api.signInMethods() });
        return true;
      }
      if (socialStart) {
        const body = (await readBody(req, BODY_LIMIT).catch(() => null)) as Record<string, unknown> | null;
        const provider = body && typeof body.provider === "string" ? body.provider : "";
        const callbackURL = body && typeof body.callbackURL === "string" ? body.callbackURL : "";
        if (!/^([a-z]{1,32})$/.test(provider) || !sameOriginSignin(req, callbackURL)) {
          noStore();
          json(res, 400, { error: "That sign-in could not be started.", code: "invalid_request" });
          return true;
        }
        const started = await api.startSocial(provider, callbackURL);
        noStore();
        json(res, 200, started);
        return true;
      }
      const token = bearerToken(req);
      if (!token) {
        noStore();
        json(res, 401, { error: "Sign in again to continue.", code: "signed_out" });
        return true;
      }
      if (memberships) {
        noStore();
        json(res, 200, await api.authed("/api/auth/memberships", { token }));
        return true;
      }
      if (signup || inviteSend || inviteAccept || inviteRevoke) {
        const body = (await readBody(req, BODY_LIMIT).catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body !== "object") {
          noStore();
          json(res, 400, { error: "Send the details as JSON.", code: "invalid_request" });
          return true;
        }
        const workerPath =
          signup ? "/api/auth/signup" : inviteSend ? "/api/auth/invite" : inviteAccept ? "/api/auth/invite/accept" : "/api/auth/revoke";
        const payload = await api.authed(workerPath, { method: "POST", token, body });
        noStore();
        json(res, signup || inviteSend ? 201 : 200, payload);
        return true;
      }
      if (workspaceMatch) {
        const id = workspaceMatch[1]!;
        const suffix = workspaceMatch[2];
        const providerId = workspaceMatch[3];
        if (!WORKSPACE_ID.test(id)) {
          noStore();
          json(res, 404, { error: "Not found. The link may have expired.", code: "not_found" });
          return true;
        }
        if (!suffix) {
          if (method !== "GET") {
            noStore();
            json(res, 405, { error: "Method not allowed.", code: "method_not_allowed" });
            return true;
          }
          noStore();
          json(res, 200, await api.authed(`/api/workspaces/${id}`, { token }));
          return true;
        }
        if (suffix === "/entitlements" || suffix === "/spend") {
          if (method !== "GET") {
            noStore();
            json(res, 405, { error: "Method not allowed.", code: "method_not_allowed" });
            return true;
          }
          noStore();
          json(res, 200, await api.authed(`/api/workspaces/${id}${suffix}`, { token }));
          return true;
        }
        if (providerId && !(PROVIDER_IDS as readonly string[]).includes(providerId)) {
          noStore();
          json(res, 404, { error: "Unknown provider.", code: "not_found" });
          return true;
        }
        if (method === "GET" && !providerId) {
          noStore();
          json(res, 200, await api.authed(`/api/workspaces/${id}/providers`, { token }));
          return true;
        }
        if (method === "PUT") {
          const body = (await readBody(req, BODY_LIMIT).catch(() => null)) as Record<string, unknown> | null;
          if (!body || typeof body !== "object") {
            noStore();
            json(res, 400, { error: "Send the details as JSON.", code: "invalid_request" });
            return true;
          }
          noStore();
          json(res, 200, await api.authed(providerId ? `/api/workspaces/${id}/providers/${providerId}` : `/api/workspaces/${id}/providers`, { method: "PUT", token, body }));
          return true;
        }
        noStore();
        json(res, 405, { error: "Method not allowed.", code: "method_not_allowed" });
        return true;
      }
      if (storeVerify) {
        const body = (await readBody(req, BODY_LIMIT).catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body !== "object") {
          noStore();
          json(res, 400, { error: "Send the details as JSON.", code: "invalid_request" });
          return true;
        }
        noStore();
        json(res, 200, await api.authed("/api/billing/store/verify", { method: "POST", token, body }));
        return true;
      }
      if (storeStatus) {
        const workspace = queryWorkspace(req);
        if (!workspace) {
          noStore();
          json(res, 400, { error: "Choose a workspace first.", code: "invalid_request" });
          return true;
        }
        noStore();
        json(res, 200, await api.authed("/api/billing/store/status", { token, query: { workspace } }));
        return true;
      }
      if (adminMatch) {
        const view = adminMatch[1]!;
        if (!(ADMIN_VIEWS as readonly string[]).includes(view)) {
          noStore();
          json(res, 404, { error: "Not found.", code: "not_found" });
          return true;
        }
        const workspace = queryWorkspace(req);
        if (!workspace) {
          noStore();
          json(res, 400, { error: "Choose a workspace first.", code: "invalid_request" });
          return true;
        }
        noStore();
        json(res, 200, await api.authed(`/api/admin/${view}`, { token, query: { workspace } }));
        return true;
      }
      return false;
    } catch (error) {
      const mapped = consoleError(error);
      noStore();
      json(res, mapped.status, mapped.body);
      return true;
    }
  };
}

function sameOriginSignin(req: IncomingMessage, callbackURL: string): boolean {
  const origin = requestOrigin(req);
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(callbackURL);
  } catch {
    return false;
  }
  return url.origin === origin && url.pathname === "/signin" && !url.username && !url.password && !url.hash;
}
