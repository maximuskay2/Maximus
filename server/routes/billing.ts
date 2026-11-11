// Billing HTTP routes. Authenticated (owner/admin only): POST
// /api/billing/checkout starts a Stripe/Paystack checkout, GET
// /api/billing/status reports plan + allowance burn-down + dunning banner for
// Settings → Usage. The webhook endpoint is intentionally NOT here: payment
// providers authenticate with a signature, so `billingWebhookRoute` runs
// before the auth gate in server/index.ts.
import type { IncomingMessage, ServerResponse } from "node:http";

import { billingBanner } from "../billing/dunning.ts";
import { bundledBudgetState } from "../billing/allowance.ts";
import { botSpendRefusal, noteBotSpend, readBotSpend } from "../billing/bot-ceiling.ts";
import { modelForBundledTask, rewriteModel } from "../billing/task-route.ts";
import { createCheckoutSession, providerPriceRefFromEnv, type CheckoutSecrets } from "../billing/checkout.ts";
import { koboFromUsd, nigeriaFromSignals, type PaymentSettings } from "../billing/payments.ts";
import { rationWorkspace } from "../billing/ration.ts";
import type { BillingProvider } from "../billing/events.ts";
import {
  extractBearerToken, forwardBundledRequest, parseGatewayRoute, tokenStoreFromEnv, type GatewayTokenStore,
} from "../billing/gateway.ts";
import { billingWebhookSecretsFromEnv, handleBillingWebhook, readRawBody } from "../billing/http.ts";
import type { BundledPlan } from "../billing/plans.ts";
import type { RationService } from "../billing/ration-service.ts";
import { BillingStore } from "../billing/store.ts";
import { billableFor, type PriceList } from "../prices.ts";
import { readDelivery } from "../delivery-settings.ts";
import { ownerOrAdmin, type RequestAuth } from "../request-auth.ts";
import { resolveProvider, type ProviderId } from "../switchboard.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BillingRouteDeps {
  dataDir: string;
  store?: BillingStore;
  plans?: ReadonlyMap<string, BundledPlan>;
  knownEntitlements?: readonly string[];
  prices?: () => PriceList | null;
  secrets?: CheckoutSecrets;
  payments?: () => PaymentSettings;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  workspace?: () => string | null;
  now?: () => number;
}

const WORKSPACE = /^[a-z][a-z0-9-]{1,30}$/;

function canPay(auth: RequestAuth): boolean {
  if (auth.kind === "session") return true;
  return auth.kind === "loopback" && auth.trust !== "service";
}

function headerText(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  return typeof value === "string" ? value : null;
}

export function createBillingRoutes(deps: BillingRouteDeps): RouteHandler {
  const env = deps.env ?? process.env;
  const store = deps.store ?? new BillingStore({ dataDir: deps.dataDir, plans: deps.plans, knownEntitlements: deps.knownEntitlements, now: deps.now });
  const workspaceOf = deps.workspace ?? (() => {
    const id = env.MAXIMUS_ADMIN_WORKSPACE ?? "";
    return WORKSPACE.test(id) ? id : null;
  });
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method === "POST" && path === "/api/billing/checkout") {
      if (!canPay(auth)) return json(res, 403, { error: "Sign in to start checkout." });
      let body: unknown;
      try {
        body = await readBody(req, 8192);
      } catch {
        return json(res, 400, { error: "expected a small JSON body" });
      }
      const value = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
      const provider = value.provider === "stripe" || value.provider === "paystack" ? value.provider as BillingProvider : null;
      const plan = typeof value.plan === "string" ? value.plan : "";
      const customerEmail = typeof value.customerEmail === "string" ? value.customerEmail : undefined;
      const successUrl = typeof value.successUrl === "string" ? value.successUrl : "";
      const cancelUrl = typeof value.cancelUrl === "string" ? value.cancelUrl : "";
      const workspace = typeof value.workspace === "string" && WORKSPACE.test(value.workspace) ? value.workspace : workspaceOf() ?? rationWorkspace(env);
      const timeZone = typeof value.timeZone === "string" ? value.timeZone : null;
      if (!provider || !plan || !workspace) return json(res, 400, { error: "provider, plan and workspace are required" });
      const catalogPlan = deps.plans?.get(plan);
      if (deps.plans && !catalogPlan) return json(res, 400, { error: `unknown plan "${plan}"` });
      const entitlements = catalogPlan?.entitlements ?? store.record(workspace)?.carried ?? [];
      const allowanceMinor = catalogPlan ? Math.round(catalogPlan.allowanceUsd * 100) : null;
      const providerPriceRef = providerPriceRefFromEnv(env, provider, plan);
      let amountMinor: number | undefined;
      if (provider === "paystack") {
        const settings = deps.payments?.() ?? { paystackEnabled: false, ngnPerUsd: 0 };
        if (!settings.paystackEnabled) return json(res, 403, { error: "Paystack is turned off." });
        if (!nigeriaFromSignals({ countryHeader: headerText(req, "cf-ipcountry"), timeZone })) {
          return json(res, 403, { error: "Paystack is available in Nigeria." });
        }
        if (!catalogPlan || !(catalogPlan.baseUsd > 0)) return json(res, 400, { error: "That plan is not for sale." });
        if (!customerEmail) return json(res, 400, { error: "Paystack needs the account email." });
        amountMinor = koboFromUsd(catalogPlan.baseUsd, settings.ngnPerUsd);
        if (!providerPriceRef && amountMinor <= 0) return json(res, 503, { error: `paystack has no price configured for plan "${plan}"` });
      } else if (!providerPriceRef) {
        return json(res, 503, { error: `${provider} has no price configured for plan "${plan}"` });
      }
      try {
        const session = await createCheckoutSession({
          provider,
          plan,
          workspaceId: workspace,
          ...(customerEmail ? { customerEmail } : {}),
          successUrl,
          cancelUrl,
          entitlements,
          allowanceMinor,
          ...(providerPriceRef ? { providerPriceRef } : {}),
          ...(amountMinor ? { amountMinor } : {}),
        }, { fetchImpl: deps.fetchImpl, secrets: deps.secrets });
        res.setHeader("cache-control", "no-store");
        return json(res, 200, { checkout: { provider: session.provider, url: session.url, sessionId: session.sessionId, livemode: session.livemode } });
      } catch (error) {
        return json(res, 502, { error: error instanceof Error ? error.message : "checkout failed" });
      }
    }
    if (method === "GET" && path === "/api/billing/status") {
      if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only an admin can view billing status." });
      const workspace = workspaceOf();
      const record = workspace ? store.record(workspace) : null;
      const granted = workspace ? store.granted(workspace) : [];
      const plan = record ? deps.plans?.get(record.plan) : undefined;
      const budget = record && record.status !== "suspended"
        ? bundledBudgetState(record.allowanceUsd ?? plan?.allowanceUsd ?? 0, plan?.hardCapUsd ?? null, deps.dataDir, deps.prices?.() ?? null)
        : null;
      res.setHeader("cache-control", "no-store");
      return json(res, 200, {
        billing: {
          workspace,
          plan: record?.plan ?? null,
          status: record?.status ?? "suspended",
          granted,
          allowanceUsd: record?.allowanceUsd ?? null,
          budget,
          banner: record ? billingBanner(record) : null,
        },
      });
    }
    return PASS;
  };
}

export interface BillingWebhookRouteDeps {
  dataDir: string;
  store?: BillingStore;
  plans?: ReadonlyMap<string, BundledPlan>;
  knownEntitlements?: readonly string[];
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  onApplied?: (event: import("../billing/events.ts").BillingEvent) => void;
}

export const MAX_GATEWAY_BODY_BYTES = 10 * 1024 * 1024;

export interface BillingGatewayRouteDeps {
  dataDir: string;
  store?: BillingStore;
  plans?: ReadonlyMap<string, BundledPlan>;
  knownEntitlements?: readonly string[];
  prices?: () => PriceList | null;
  tokens?: GatewayTokenStore;
  keys?: (envName: string) => string | undefined;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  ration?: RationService;
}

/**
 * Pre-auth entry for the managed gateway (`/api/gateway/{workspace}/{provider}/*`, contracts section 7). The
 * workspace token (not a session) authenticates, the gateway entitlement gates, and the hard cap refuses. Catalog
 * enforcement and key isolation live in forwardBundledRequest. Self-host reads the assigned catalog from the
 * workspace switchboard policy; a multi-tenant control plane resolves it per workspace record (Track 3).
 */
export async function billingGatewayRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  json: (res: ServerResponse, status: number, body: unknown) => void,
  deps: BillingGatewayRouteDeps,
): Promise<boolean> {
  const route = parseGatewayRoute(path);
  if (!route || (method !== "GET" && method !== "POST")) return false;
  const env = deps.env ?? process.env;
  const tokens = deps.tokens ?? tokenStoreFromEnv(env);
  const token = extractBearerToken(req.headers as Record<string, string | undefined>);
  const workspace = token ? tokens.workspaceFor(token) : null;
  if (!token || workspace !== route.workspace) {
    json(res, 401, { error: "Invalid workspace token" });
    return true;
  }
  const store = deps.store ?? new BillingStore({ dataDir: deps.dataDir, plans: deps.plans, knownEntitlements: deps.knownEntitlements, now: deps.now });
  if (!store.granted(workspace).includes("gateway")) {
    json(res, 403, { error: "LLM-included routing needs the gateway entitlement. Upgrade to route this provider through the managed gateway." });
    return true;
  }
  let raw = "";
  if (method === "POST") {
    try {
      raw = await readRawBody(req, MAX_GATEWAY_BODY_BYTES);
    } catch (error) {
      const status = (error as Error & { status?: number }).status ?? 400;
      json(res, status, { error: error instanceof Error ? error.message : "Could not read gateway body" });
      return true;
    }
  }
  let botId = "";
  if (method === "POST") {
    const delivery = readDelivery(deps.dataDir);
    const routed = delivery.formatModel ? modelForBundledTask(raw, delivery.formatModel, false) : null;
    if (routed) {
      try {
        raw = rewriteModel(raw, routed);
      } catch {
        json(res, 400, { error: "Could not read gateway body" });
        return true;
      }
    }
    const botHeader = req.headers["x-maximus-bot"];
    botId = typeof botHeader === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(botHeader) ? botHeader : "";
    const ceiling = botId ? delivery.ceilings[botId] : undefined;
    if (botId && typeof ceiling === "number") {
      const refusal = botSpendRefusal(readBotSpend(deps.dataDir, botId), ceiling);
      if (refusal) {
        json(res, 409, { error: refusal.message, code: refusal.code });
        return true;
      }
    }
  }
  const catalog = (ws: string, provider: ProviderId): string[] | null => {
    if (ws !== workspace) return null;
    const verdict = resolveProvider(provider, undefined, env);
    return verdict.allowed && verdict.mode === "bundled" && verdict.models ? [...verdict.models] : null;
  };
  const record = store.record(workspace);
  const plan = record ? deps.plans?.get(record.plan) : undefined;
  const prices = deps.prices?.() ?? null;
  if (method === "POST" && route.provider === "muse" && deps.ration) {
    const refusal = deps.ration.preflight(workspace, modelFromGatewayBody(raw), raw, deps.now ? new Date(deps.now()) : new Date());
    if (refusal) {
      json(res, refusal.status, { error: refusal.message, code: refusal.code });
      return true;
    }
  }
  const result = await forwardBundledRequest(
    { method, path, headers: req.headers as Record<string, string | undefined>, rawBody: raw },
    {
      tokens,
      catalog,
      keys: (name) => {
        if (name === "MAXIMUS_GATEWAY_META_KEY" && deps.ration?.metaKey()) return deps.ration.metaKey()!;
        return deps.keys?.(name) ?? env[name];
      },
      fetchImpl: deps.fetchImpl,
      dataDir: deps.dataDir,
      prices: () => prices,
      budget: record && record.status !== "suspended"
        ? () => bundledBudgetState(record.allowanceUsd ?? plan?.allowanceUsd ?? 0, plan?.hardCapUsd ?? null, deps.dataDir, prices)
        : undefined,
    },
  );
  if (result.metered && botId && prices) {
    const usd = billableFor({
      driverKind: route.provider,
      model: result.metered.model,
      input: result.metered.input,
      output: result.metered.output,
      cachedInput: result.metered.cachedInput,
    }, prices);
    if (usd) noteBotSpend(deps.dataDir, botId, usd);
  }
  if (result.metered && route.provider === "muse" && deps.ration) {
    const cached = result.metered.cachedInput ?? 0;
    deps.ration.debit(workspace, result.metered.model, {
      freshInput: Math.max(0, result.metered.input - cached),
      cachedInput: Math.min(cached, result.metered.input),
      output: result.metered.output,
    }, deps.now ? new Date(deps.now()) : new Date());
  }
  res.writeHead(result.status, { "content-type": result.contentType, "cache-control": "no-store" });
  res.end(result.body);
  return true;
}

/** Pre-auth entry for POST /api/billing/webhook/{stripe,paystack}. True when the request was answered. */
export async function billingWebhookRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  json: (res: ServerResponse, status: number, body: unknown) => void,
  deps: BillingWebhookRouteDeps,
): Promise<boolean> {
  const provider = path === "/api/billing/webhook/stripe" ? "stripe" : path === "/api/billing/webhook/paystack" ? "paystack" : null;
  if (!provider) return false;
  const env = deps.env ?? process.env;
  const store = deps.store ?? new BillingStore({ dataDir: deps.dataDir, plans: deps.plans, knownEntitlements: deps.knownEntitlements, now: deps.now });
  let raw: string;
  try {
    raw = await readRawBody(req);
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    json(res, status, { error: error instanceof Error ? error.message : "Could not read webhook body" });
    return true;
  }
  const result = handleBillingWebhook(provider, req.headers as Record<string, string | string[] | undefined>, raw, {
    store,
    secrets: billingWebhookSecretsFromEnv(env),
    onApplied: deps.onApplied,
  });
  res.setHeader("cache-control", "no-store");
  json(res, result.status, result.body);
  return true;
}

function modelFromGatewayBody(raw: string): string {
  try {
    const model = (JSON.parse(raw) as { model?: unknown }).model;
    return typeof model === "string" ? model : "";
  } catch {
    return "";
  }
}
