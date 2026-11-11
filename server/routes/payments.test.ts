import { mkdtempSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PaymentStore } from "../billing/payments.ts";
import type { BundledPlan } from "../billing/plans.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createPaymentRoutes } from "./payments.ts";
import type { RouteContext } from "./table.ts";

const PLANS = new Map<string, BundledPlan>([
  ["plus", { id: "plus", baseUsd: 19, allowanceUsd: 8, hardCapUsd: 8, entitlements: ["billing"] }],
]);

function ctx(path: string, method: string, auth: RequestAuth, body?: unknown, headers: Record<string, string> = {}) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const route: RouteContext = {
    req: { headers } as IncomingMessage,
    res: { setHeader: () => {} } as unknown as ServerResponse,
    url: new URL(path, "http://localhost"),
    path: new URL(path, "http://localhost").pathname,
    method,
    auth,
    json: ((_res, status, payload) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
    readBody: (async () => body) as RouteContext["readBody"],
  };
  return { route, sent };
}

describe("payment routes", () => {
  it("shows naira in Nigeria only after the switch is on", async () => {
    const store = new PaymentStore(mkdtempSync(join(tmpdir(), "pay-routes-")));
    const handler = createPaymentRoutes({ store, plans: PLANS });
    const session = { kind: "session", scopes: ["client"] } as unknown as RequestAuth;
    const off = ctx("/api/billing/offer?timeZone=Africa/Lagos", "GET", session);
    await handler(off.route);
    expect(off.sent[0]?.body).toMatchObject({ offer: { currency: "USD", provider: "stripe" } });
    expect(store.save({ paystackEnabled: true, ngnPerUsd: 1600 })).toBeNull();
    const on = ctx("/api/billing/offer?timeZone=Africa/Lagos", "GET", session);
    await handler(on.route);
    expect(on.sent[0]?.body).toMatchObject({ offer: { currency: "NGN", provider: "paystack", plans: [{ id: "plus", ngn: 30400 }] } });
    const abroad = ctx("/api/billing/offer?timeZone=Europe/London", "GET", session, undefined, { "cf-ipcountry": "GB" });
    await handler(abroad.route);
    expect(abroad.sent[0]?.body).toMatchObject({ offer: { currency: "USD" } });
  });
});
