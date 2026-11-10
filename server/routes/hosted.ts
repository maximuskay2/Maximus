// Hosted workspace surfaces (roadmap Track 3): the synced entitlement/plan
// view and the BYO-vs-bundled routing view. Both sit behind the auth gate in
// server/index.ts; the entitlement view additionally narrows for members the
// way /api/edition does. Versioned like the control plane (contracts section
// 6): a wire mismatch fails 409 with MAXIMUS_CONTRACT_MISMATCH, never a
// silent downgrade.
import type { IncomingMessage } from "node:http";

import type { EntitlementSync } from "../entitlement-sync.ts";
import { MAXIMUS_CONTRACT_HEADER, MAXIMUS_CONTRACT_MISMATCH, MAXIMUS_CONTRACT_VERSION, maximusContractCompatible } from "../maximus-contract.ts";
import { PROVIDER_IDS, resolveProvider } from "../switchboard.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface HostedRouteDeps {
  /** Null unless this server is a portal-managed hosted workspace. */
  sync: () => EntitlementSync | null;
}

function contractRefusal(req: IncomingMessage): { status: 409; error: string; code: string } | null {
  const header = req.headers[MAXIMUS_CONTRACT_HEADER];
  const raw = Array.isArray(header) ? header[0] : header;
  const version = raw === undefined ? undefined : Number(raw);
  return maximusContractCompatible(version) ? null : { status: 409, error: "Admin and workspace runtime versions are incompatible. Ask your administrator to update the deployment.", code: MAXIMUS_CONTRACT_MISMATCH };
}

export function createHostedRoutes(deps: HostedRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json }) => {
    if (method !== "GET" || (path !== "/api/hosted/entitlements" && path !== "/api/hosted/routing")) return PASS;
    const sync = deps.sync();
    if (!sync) return json(res, 503, { error: "Hosted entitlements are unavailable." });
    const mismatch = contractRefusal(req);
    if (mismatch) return json(res, mismatch.status, { error: mismatch.error, code: mismatch.code });
    res.setHeader(MAXIMUS_CONTRACT_HEADER, String(MAXIMUS_CONTRACT_VERSION));
    res.setHeader("cache-control", "no-store");
    const view = sync.view();
    if (path === "/api/hosted/entitlements") {
      if (!auth.scopes.includes("admin")) {
        return json(res, 200, { entitlements: { workspace: view.workspace, granted: view.granted, banner: view.banner, offline: view.offline } });
      }
      return json(res, 200, {
        entitlements: {
          workspace: view.workspace,
          plan: view.plan,
          granted: view.granted,
          allowance: view.allowance,
          status: view.status,
          ...(view.graceEndsAt !== null ? { graceEndsAt: view.graceEndsAt } : {}),
          banner: view.banner,
          syncedAt: view.syncedAt,
          offline: view.offline,
        },
      });
    }
    const workspace = sync.workspacePolicy();
    const routing: Record<string, { allowed: boolean; via: string; reason?: string; models?: string[] }> = {};
    for (const id of PROVIDER_IDS) {
      const verdict = resolveProvider(id, workspace ? { workspace } : undefined);
      if (!verdict.allowed) {
        routing[id] = { allowed: false, via: "off", ...(verdict.reason ? { reason: verdict.reason } : {}) };
      } else if (verdict.mode === "bundled") {
        routing[id] = { allowed: true, via: "bundled", ...(verdict.models ? { models: verdict.models } : {}) };
      } else {
        routing[id] = { allowed: true, via: "byo" };
      }
    }
    return json(res, 200, {
      routing: {
        workspace: view.workspace,
        bundledEntitled: view.granted.includes("gateway"),
        providers: routing,
        offline: view.offline,
      },
    });
  };
}
