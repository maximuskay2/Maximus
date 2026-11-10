// Admin ration: GET/PUT /api/admin/ration and PUT /api/admin/ration/pool-key.
// Owner or admin scope only. The pooled key is write-only.
// GET /api/ration is the signed-in wallet. It never includes the pooled key.
import type { IncomingMessage } from "node:http";

import { ownerOrAdmin, type RequestAuth } from "../request-auth.ts";
import { plansFromRation, rationWorkspace, type FreeIdentity, type RationProfile } from "../billing/ration.ts";
import type { RationService } from "../billing/ration-service.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface RationRouteDeps {
  ration: RationService;
  /** Writes the four ration plans into the live catalog after a successful save. */
  syncPlans?: (profile: RationProfile) => void;
}

const BODY_LIMIT = 65_536;

function identityOf(auth: RequestAuth, req: IncomingMessage): FreeIdentity {
  const email = auth.kind === "session" ? auth.session?.email : undefined;
  const header = req.headers["x-maximus-install"];
  const installId = typeof header === "string" ? header : undefined;
  return { ...(email ? { email } : {}), ...(installId ? { installId } : {}) };
}

export function createRationRoutes(deps: RationRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const contributor = method === "POST" && path === "/api/ration/contributor";
    if ((method === "GET" && path === "/api/ration") || contributor) {
      res.setHeader("cache-control", "no-store");
      const identity = identityOf(auth, req);
      const workspace = rationWorkspace();
      if (contributor) {
        let body: unknown = null;
        try {
          body = await readBody(req, BODY_LIMIT);
        } catch {
          return json(res, 400, { error: "unreadable rate body" });
        }
        const accept = body && typeof body === "object" ? (body as { accept?: unknown }).accept : undefined;
        if (typeof accept !== "boolean") return json(res, 400, { error: "accept must be true or false" });
        deps.ration.acceptContributor(workspace, accept, new Date(), identity);
      }
      json(res, 200, deps.ration.walletView(workspace, new Date(), identity));
      return;
    }
    const profile = (method === "GET" || method === "PUT") && path === "/api/admin/ration";
    const pool = method === "PUT" && path === "/api/admin/ration/pool-key";
    if (!profile && !pool) return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only an admin can manage rates." });
    res.setHeader("cache-control", "no-store");
    if (method === "GET") {
      json(res, 200, deps.ration.view());
      return;
    }
    let body: unknown = null;
    try {
      body = await readBody(req, BODY_LIMIT);
    } catch {
      return json(res, 400, { error: "unreadable rate body" });
    }
    if (pool) {
      const key = body && typeof body === "object" ? (body as { key?: unknown }).key : undefined;
      if (typeof key !== "string") return json(res, 400, { error: "key must be a string" });
      deps.ration.setPoolKey(key);
      json(res, 200, { pool: deps.ration.view().pool });
      return;
    }
    const error = deps.ration.saveProfile(body);
    if (error) return json(res, 400, { error });
    deps.syncPlans?.(deps.ration.profileNow());
    json(res, 200, { ...deps.ration.view(), plans: plansFromRation(deps.ration.profileNow()) });
  };
}
