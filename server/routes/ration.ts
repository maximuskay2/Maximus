// Admin ration: GET/PUT /api/admin/ration and PUT /api/admin/ration/pool-key.
// Owner or admin scope only. The pooled key is write-only.
// GET /api/ration is the signed-in wallet. It never includes the pooled key.
import type { IncomingMessage } from "node:http";

import { ownerOrAdmin, type RequestAuth } from "../request-auth.ts";
import type { GrantMailer } from "../billing/grant-mail.ts";
import { grantInstallId } from "../billing/grant-identity.ts";
import { plansFromRation, rationWorkspace, type FreeIdentity, type RationProfile } from "../billing/ration.ts";
import type { RationService } from "../billing/ration-service.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface RationRouteDeps {
  ration: RationService;
  /** Writes the four ration plans into the live catalog after a successful save. */
  syncPlans?: (profile: RationProfile) => void;
  /** Optional notice when an admin grants credit or a plan. Failures do not undo the grant. */
  grantMail?: GrantMailer | null;
}

const BODY_LIMIT = 65_536;

function identityOf(auth: RequestAuth, req: IncomingMessage): FreeIdentity {
  const email = auth.kind === "session" ? auth.session?.email : undefined;
  const header = req.headers["x-maximus-install"];
  const installId = grantInstallId(typeof header === "string" ? header : Array.isArray(header) ? header[0] : undefined);
  return { ...(email ? { email } : {}), ...(installId ? { installId } : {}) };
}

const FREE_USED = "This email or device already used the free Muse grant. Subscribe to Your model or a Muse plan.";

export function createRationRoutes(deps: RationRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path === "/api/account/plan" && (method === "GET" || method === "POST")) {
      res.setHeader("cache-control", "no-store");
      const email = auth.kind === "session" ? auth.session.email : undefined;
      if (!email) return json(res, 200, { choice: null });
      const identity = identityOf(auth, req);
      const freeAvailable = deps.ration.freeGrantOpen(identity);
      if (method === "GET") return json(res, 200, { choice: deps.ration.accountChoice(email), freeAvailable });
      let body: unknown = null;
      try {
        body = await readBody(req, BODY_LIMIT);
      } catch {
        return json(res, 400, { error: "unreadable plan body" });
      }
      const requested = body && typeof body === "object" ? (body as { choice?: unknown }).choice : undefined;
      if (requested !== "free" && requested !== "byo" && requested !== "muse") return json(res, 400, { error: "choice must be free, byo, or muse" });
      if (requested === "free" && !freeAvailable && deps.ration.accountChoice(email) !== "free") {
        return json(res, 409, { error: FREE_USED, code: "free_used", choice: deps.ration.accountChoice(email), freeAvailable: false });
      }
      const choice = deps.ration.chooseAccount(email, requested);
      if (choice === "free") deps.ration.ensureFree(rationWorkspace(), new Date(), identity);
      return json(res, 200, { choice, freeAvailable: choice === "free" ? deps.ration.freeGrantOpen(identity) : freeAvailable });
    }
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
    const grants = path === "/api/admin/grants" && (method === "GET" || method === "POST");
    const profile = (method === "GET" || method === "PUT") && path === "/api/admin/ration";
    const pool = method === "PUT" && path === "/api/admin/ration/pool-key";
    if (!profile && !pool && !grants) return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: grants ? "Only an admin can grant credit or a plan." : "Only an admin can manage rates." });
    res.setHeader("cache-control", "no-store");
    if (grants && method === "GET") return json(res, 200, { grants: deps.ration.listGrants() });
    if (grants) {
      let body: unknown = null;
      try {
        body = await readBody(req, BODY_LIMIT);
      } catch {
        return json(res, 400, { error: "unreadable grant body" });
      }
      const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
      if (typeof value.email !== "string") return json(res, 400, { error: "Enter the person's email address." });
      const creditUsd = typeof value.creditUsd === "number" ? value.creditUsd : undefined;
      const tokens = typeof value.tokens === "number" ? value.tokens : undefined;
      const plan = typeof value.plan === "string" ? value.plan : undefined;
      const note = typeof value.note === "string" ? value.note : undefined;
      const granted = deps.ration.grantAccount({
        email: value.email,
        ...(plan !== undefined ? { plan } : {}),
        ...(creditUsd !== undefined ? { creditUsd } : {}),
        ...(tokens !== undefined ? { tokens } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(value.renew === true ? { renew: true } : {}),
      });
      if (!granted.ok) return json(res, 400, { error: granted.error });
      if (deps.grantMail) {
        try {
          await deps.grantMail.send({
            email: granted.seat.email,
            creditUsd,
            tokens,
            plan: plan ?? granted.seat.plan,
            leftUsd: granted.seat.leftUsd,
            note,
          });
        } catch (error) {
          console.warn(`grant mail not sent: ${error instanceof Error ? error.message : "mail failed"}`);
        }
      }
      return json(res, 200, { seat: granted.seat, grants: deps.ration.listGrants() });
    }
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
