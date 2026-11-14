// Paystack/Bachs switches and gateway secrets. GET/PUT /api/admin/payments is
// the operator's on/off, Naira rate, and secret paste (secrets never leave as
// full values). GET /api/billing/offer is the public price quote for /pricing.
import type { IncomingMessage, ServerResponse } from "node:http";

import type { BundledPlan } from "../billing/plans.ts";
import {
  nairaFromUsd,
  nigeriaFromSignals,
  PaymentStore,
  type GatewaySecrets,
  type PaymentSettings,
} from "../billing/payments.ts";
import { json } from "../harness/http.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PaymentRouteDeps {
  store: PaymentStore;
  plans: ReadonlyMap<string, BundledPlan>;
}

const BODY_LIMIT = 16_384;

function headerText(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  return typeof value === "string" ? value : null;
}

export function offerPayload(
  deps: PaymentRouteDeps,
  signals: { countryHeader?: string | null; timeZone?: string | null },
): { offer: ReturnType<typeof offerFor> } {
  return { offer: offerFor(deps.store.read(), nigeriaFromSignals(signals), deps.plans) };
}

/** Public price quote — called before the auth gate so a dead session still sees /pricing. */
export async function billingOfferRoute(
  deps: PaymentRouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  searchParams: URLSearchParams,
): Promise<boolean> {
  if (method !== "GET" || path !== "/api/billing/offer") return false;
  res.setHeader("cache-control", "no-store");
  json(res, 200, offerPayload(deps, {
    countryHeader: headerText(req, "cf-ipcountry"),
    timeZone: searchParams.get("timeZone"),
  }));
  return true;
}

function offerFor(settings: PaymentSettings, nigeria: boolean, plans: ReadonlyMap<string, BundledPlan>) {
  // Bachs is the primary checkout when enabled. Paystack is Naira-only and only
  // used when Bachs is off — operators flip either switch in Admin → Rates any time.
  const bachs = settings.bachsEnabled;
  const paystack = !bachs && settings.paystackEnabled && nigeria;
  const provider = bachs ? "bachs" : paystack ? "paystack" : "stripe";
  return {
    paystackEnabled: settings.paystackEnabled,
    bachsEnabled: settings.bachsEnabled,
    country: nigeria ? "NG" : "OTHER",
    currency: paystack ? "NGN" : "USD",
    provider,
    ngnPerUsd: settings.ngnPerUsd,
    plans: [...plans.values()].filter((plan) => plan.baseUsd > 0).map((plan) => ({
      id: plan.id,
      usd: plan.baseUsd,
      ngn: nairaFromUsd(plan.baseUsd, settings.ngnPerUsd),
    })),
  };
}

function optionalSecret(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function createPaymentRoutes(deps: PaymentRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, url, json, readBody }) => {
    if (method === "GET" && path === "/api/billing/offer") {
      res.setHeader("cache-control", "no-store");
      return json(res, 200, offerPayload(deps, {
        countryHeader: headerText(req, "cf-ipcountry"),
        timeZone: url.searchParams.get("timeZone"),
      }));
    }
    if (path !== "/api/admin/payments" || (method !== "GET" && method !== "PUT")) return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only an operator can change payment gateways." });
    res.setHeader("cache-control", "no-store");
    if (method === "GET") return json(res, 200, { payments: deps.store.adminView() });
    let body: unknown = null;
    try {
      body = await readBody(req, BODY_LIMIT);
    } catch {
      return json(res, 400, { error: "unreadable payment body" });
    }
    const value = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const next: PaymentSettings = {
      paystackEnabled: value.paystackEnabled === true,
      bachsEnabled: value.bachsEnabled === true,
      ngnPerUsd: typeof value.ngnPerUsd === "number" ? value.ngnPerUsd : Number.NaN,
    };
    const settingsError = deps.store.save(next);
    if (settingsError) return json(res, 400, { error: settingsError });
    const secretsPatch: Partial<Record<keyof GatewaySecrets, string | undefined>> = {};
    if (Object.hasOwn(value, "paystackSecretKey")) secretsPatch.paystackSecretKey = optionalSecret(value.paystackSecretKey);
    if (Object.hasOwn(value, "bachsApiKey")) secretsPatch.bachsApiKey = optionalSecret(value.bachsApiKey);
    if (Object.hasOwn(value, "bachsWebhookSecret")) secretsPatch.bachsWebhookSecret = optionalSecret(value.bachsWebhookSecret);
    if (Object.hasOwn(value, "stripeSecretKey")) secretsPatch.stripeSecretKey = optionalSecret(value.stripeSecretKey);
    if (Object.hasOwn(value, "bachsApiBase")) secretsPatch.bachsApiBase = optionalSecret(value.bachsApiBase);
    if (Object.keys(secretsPatch).length > 0) {
      const secretsError = deps.store.saveSecrets(secretsPatch);
      if (secretsError) return json(res, 400, { error: secretsError });
    }
    return json(res, 200, { payments: deps.store.adminView() });
  };
}
