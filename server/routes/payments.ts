// Paystack switch. GET/PUT /api/admin/payments is the operator's on/off and
// Naira-per-dollar rate. GET /api/billing/offer is the public price quote for
// /pricing. The country header from Cloudflare wins; otherwise
// the device timezone is the pilot signal.
import type { IncomingMessage, ServerResponse } from "node:http";

import type { BundledPlan } from "../billing/plans.ts";
import { nairaFromUsd, nigeriaFromSignals, PaymentStore, type PaymentSettings } from "../billing/payments.ts";
import { json } from "../harness/http.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PaymentRouteDeps {
  store: PaymentStore;
  plans: ReadonlyMap<string, BundledPlan>;
}

const BODY_LIMIT = 4096;

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
  const paystack = settings.paystackEnabled && nigeria;
  return {
    paystackEnabled: settings.paystackEnabled,
    country: nigeria ? "NG" : "OTHER",
    currency: paystack ? "NGN" : "USD",
    provider: paystack ? "paystack" : "stripe",
    ngnPerUsd: settings.ngnPerUsd,
    plans: [...plans.values()].filter((plan) => plan.baseUsd > 0).map((plan) => ({
      id: plan.id,
      usd: plan.baseUsd,
      ngn: nairaFromUsd(plan.baseUsd, settings.ngnPerUsd),
    })),
  };
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
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only an operator can change Paystack." });
    res.setHeader("cache-control", "no-store");
    if (method === "GET") return json(res, 200, { payments: deps.store.read() });
    let body: unknown = null;
    try {
      body = await readBody(req, BODY_LIMIT);
    } catch {
      return json(res, 400, { error: "unreadable payment body" });
    }
    const value = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const next: PaymentSettings = {
      paystackEnabled: value.paystackEnabled === true,
      ngnPerUsd: typeof value.ngnPerUsd === "number" ? value.ngnPerUsd : Number.NaN,
    };
    const error = deps.store.save(next);
    if (error) return json(res, 400, { error });
    return json(res, 200, { payments: deps.store.read() });
  };
}
