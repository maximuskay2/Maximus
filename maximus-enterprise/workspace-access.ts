// Copyright (c) 2026 Maximus. All rights reserved.
// Proprietary and confidential: this file is part of the Maximus Enterprise
// layer and is licensed under the Maximus Enterprise License
// (maximus-enterprise/LICENSE), not the Apache License 2.0.

// Hosted sign-in adapter: the portal is the only sign-in authority on a
// portal-managed workspace. Implements the WorkspaceAccess interface from
// server/enterprise.ts (handlePublic/authorize/revalidate) with no runtime
// imports outside node builtins, so the packaged bundle stays hermetic.
//
// Protocol (docs/verification/hosted-workspaces.md): GET
// /api/auth/hosted/start mints bounded, expiring state plus a PKCE verifier,
// sets a secure host-only handoff cookie, and redirects to the identity
// service's /connect. The service returns a one-use code to
// /api/auth/hosted/callback, which consumes local state first and redeems the
// code at POST {admin}/api/handoff/consume for email, role and a
// workspace-bound grant. Every authenticated remote request rechecks the
// membership at POST {admin}/api/handoff/check; removal or loss of an issued
// scope revokes the session, while promotion never widens it. Outages and
// contract mismatches deny access and close streams without revoking
// sessions, so recovery needs no new sign-in. Local pairing codes and email
// sign-in stay refused by core while hosted access is configured.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkspaceAccess, WorkspaceAccessOptions } from "../server/enterprise.ts";
import type { RequestAuth } from "../server/request-auth.ts";
import type { Scope } from "../server/sessions.ts";

const START_PATH = "/api/auth/hosted/start";
const CALLBACK_PATH = "/api/auth/hosted/callback";
const CONSUME_PATH = "/api/handoff/consume";
const CHECK_PATH = "/api/handoff/check";

/** Must match server/maximus-contract.ts; the wire version is frozen at 1 by contracts section 6. */
const CONTRACT_VERSION = 1;
const CONTRACT_MISMATCH = "MAXIMUS_CONTRACT_MISMATCH";
const CONTRACT_ERROR = "Admin and workspace runtime versions are incompatible. Ask your administrator to update the deployment.";
const GRANT = /^[A-Za-z0-9_-]{43}$/;
const STATE = /^[A-Za-z0-9_-]{43}$/;
const WORKSPACE = /^[a-z][a-z0-9-]{1,30}$/;
/** Backchannel deadline: with the 10s revalidation cadence, stale portal access is bounded to fifteen seconds. */
const BACKCHANNEL_TIMEOUT_MS = 5_000;
const STATE_TTL_MS = 10 * 60_000;
const MAX_PENDING_PER_SOURCE = 10;
const MAX_PENDING_TOTAL = 1000;

interface HostedConfig {
  admin: URL;
  workspace: string;
}

function readHostedConfig(env: NodeJS.ProcessEnv): HostedConfig | null {
  try {
    const origin = (raw: string | undefined): URL => {
      if (!raw || raw !== raw.trim()) throw new Error("missing origin");
      const url = new URL(raw);
      if (url.protocol !== "https:" || (raw !== url.origin && raw !== `${url.origin}/`)) throw new Error("invalid origin");
      return url;
    };
    if (!WORKSPACE.test(env["MAXIMUS_ADMIN_WORKSPACE"] ?? "")) return null;
    return { admin: origin(env["MAXIMUS_ADMIN_URL"]), workspace: env["MAXIMUS_ADMIN_WORKSPACE"]! };
  } catch {
    return null;
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { location, "cache-control": "no-store" });
  res.end();
}

function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out.set(name, decodeURIComponent(part.slice(eq + 1).trim()));
    } catch {
      out.set(name, part.slice(eq + 1).trim());
    }
  }
  return out;
}

function secureRequest(req: IncomingMessage): boolean {
  if (req.headers["x-forwarded-proto"] === "https") return true;
  return (req.socket as { encrypted?: boolean }).encrypted === true;
}

/** The handoff state lives in a __Host- cookie on secure requests, a plain one otherwise. */
function stateCookieName(req: IncomingMessage): string {
  return secureRequest(req) ? "__Host-maximus-portal-state" : "maximus-portal-state";
}

function serializeCookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function isLoopbackHost(host: string | undefined): boolean {
  const name = (host ?? "").split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
  return name === "" || name === "localhost" || name === "localhost." || name === "::1" || name === "127.0.0.1" || name.startsWith("127.");
}

/** A request that arrived through the workspace's public front door rather than loopback. */
function isRemote(req: IncomingMessage): boolean {
  if (req.headers["x-forwarded-for"] !== undefined) return true;
  return !isLoopbackHost(req.headers.host);
}

function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function scopesForRole(role: unknown): Scope[] | null {
  if (role === "admin" || role === "owner") return ["admin", "client"];
  if (role === "member") return ["client"];
  return null;
}

interface PortalIdentity {
  email: string;
  role: "admin" | "owner" | "member";
}

type BackchannelResult =
  | { ok: true; identity: PortalIdentity; grant?: string }
  | { ok: false; status: 401 | 403 | 503; error: string; soft?: boolean };

/**
 * One backchannel call: TLS to the configured origin only, no cookies, no
 * redirect following, five-second deadline. `soft` failures (outage,
 * mismatch, unreachable) deny access without revoking sessions; hard 401s
 * end them.
 */
async function backchannel(
  admin: URL,
  path: string,
  payload: Record<string, string | number>,
  fetchImpl: typeof fetch,
): Promise<BackchannelResult> {
  let response: Response;
  try {
    response = await fetchImpl(new URL(path, admin).href, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, contractVersion: CONTRACT_VERSION }),
      signal: AbortSignal.timeout(BACKCHANNEL_TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    return { ok: false, status: 503, error: "Workspace sign-in is unavailable.", soft: true };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const record = (body ?? {}) as Record<string, unknown>;
  if (response.status === 409 || record["code"] === CONTRACT_MISMATCH || record["error"] === CONTRACT_MISMATCH) {
    return { ok: false, status: 503, error: CONTRACT_ERROR, soft: true };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, status: response.status, error: "This portal sign-in is no longer valid. Start again from the portal." };
  }
  if (!response.ok || response.status === 503) {
    return { ok: false, status: 503, error: "Workspace sign-in is unavailable.", soft: true };
  }
  // Legacy-v1: an omitted version reads as the v1 payload; any explicit non-1 version is a mismatch.
  if (record["contractVersion"] !== undefined && record["contractVersion"] !== CONTRACT_VERSION) {
    return { ok: false, status: 503, error: CONTRACT_ERROR, soft: true };
  }
  if (typeof record["email"] !== "string" || !record["email"] || record["email"].length > 320) {
    return { ok: false, status: 503, error: "Workspace sign-in is unavailable.", soft: true };
  }
  if (scopesForRole(record["role"]) === null) {
    return { ok: false, status: 401, error: "This portal sign-in is no longer valid. Start again from the portal." };
  }
  const grant = record["grant"];
  if (grant !== undefined && (typeof grant !== "string" || !GRANT.test(grant))) {
    return { ok: false, status: 503, error: "Workspace sign-in is unavailable.", soft: true };
  }
  return {
    ok: true,
    identity: { email: record["email"], role: record["role"] as PortalIdentity["role"] },
    ...(typeof grant === "string" ? { grant } : {}),
  };
}

interface PendingStart {
  verifier: string;
  expiresAt: number;
  source: string;
}

export function createWorkspaceAccess(options: WorkspaceAccessOptions): WorkspaceAccess {
  const { sessions, cookieName, closeSessionStreams, entitled } = options;
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  /** Pending sign-in starts by state: bounded per source, expiring, consumed before use. Never evicted. */
  const pending = new Map<string, PendingStart>();

  const prunePending = (): void => {
    const at = now();
    for (const [state, start] of pending) {
      if (start.expiresAt <= at) pending.delete(state);
    }
  };

  return {
    async handlePublic(req, res, url): Promise<boolean> {
      const path = url.pathname;
      const method = req.method ?? "GET";
      if (method === "GET" && ![START_PATH, CALLBACK_PATH].includes(path)) {
        // Remote navigation without a live portal session funnels into the portal sign-in.
        if ((path === "/" || path === "/pair") && isRemote(req)) {
          const hosted = readHostedConfig(env);
          if (!hosted || !entitled()) return false;
          const token = parseCookies(req.headers.cookie).get(cookieName);
          const record = token ? sessions.authenticate(token) : null;
          if (record && record.membershipAuthority === "portal" && sessions.isLive(record.id)) return false;
          redirect(res, START_PATH);
          return true;
        }
        return false;
      }
      if (method !== "GET") return false;
      const hosted = readHostedConfig(env);
      if (!hosted || !entitled()) {
        json(res, 503, { error: "Workspace sign-in is unavailable." });
        return true;
      }
      if (path === START_PATH) {
        prunePending();
        const source = req.socket.remoteAddress ?? "hosted";
        let held = 0;
        for (const start of pending.values()) {
          if (start.source === source) held += 1;
        }
        if (held >= MAX_PENDING_PER_SOURCE || pending.size >= MAX_PENDING_TOTAL) {
          json(res, 429, { error: "Too many pending sign-ins. Wait a moment and try again." });
          return true;
        }
        const state = randomBytes(32).toString("base64url");
        const verifier = randomBytes(32).toString("base64url");
        pending.set(state, { verifier, expiresAt: now() + STATE_TTL_MS, source });
        const secure = secureRequest(req);
        res.setHeader("set-cookie", serializeCookie(stateCookieName(req), state, STATE_TTL_MS / 1000, secure));
        const challenge = createHash("sha256").update(verifier, "utf8").digest("base64url");
        const login = new URL("/connect", hosted.admin);
        login.search = new URLSearchParams({
          workspace: hosted.workspace, state, code_challenge: challenge, code_challenge_method: "S256",
        }).toString();
        redirect(res, login.href);
        return true;
      }
      if (path === CALLBACK_PATH) {
        const source = req.socket.remoteAddress ?? "hosted";
        const attempt = sessions.attemptAllowed(source);
        if (!attempt.ok) {
          res.setHeader("retry-after", String(Math.ceil(attempt.retryAfterMs / 1000)));
          json(res, 429, { error: "Too many sign-in attempts. Wait a moment and try again." });
          return true;
        }
        const cookies = parseCookies(req.headers.cookie);
        const state = url.searchParams.get("state") ?? "";
        const code = url.searchParams.get("code") ?? "";
        const start = STATE.test(state) ? pending.get(state) : undefined;
        if (!start || !sameState(cookies.get(stateCookieName(req)) ?? "", state)) {
          sessions.noteFailure(source);
          json(res, 400, { error: "This portal sign-in expired before it finished. Start again from the portal." });
          return true;
        }
        // Consumed before the backchannel call: a code is one-use even if the call is slow.
        pending.delete(state);
        if (start.expiresAt <= now() || !GRANT.test(code)) {
          sessions.noteFailure(source);
          json(res, 401, { error: "This portal sign-in link has expired or was already used. Start again from the portal." });
          return true;
        }
        const redeemed = await backchannel(hosted.admin, CONSUME_PATH,
          { workspace: hosted.workspace, code, verifier: start.verifier }, fetchImpl);
        if (!redeemed.ok || !redeemed.grant) {
          sessions.noteFailure(source);
          if (!redeemed.ok && (redeemed.status === 401 || redeemed.status === 403)) {
            json(res, redeemed.status, { error: "This portal sign-in link has expired or was already used. Start again from the portal." });
          } else {
            json(res, 503, { error: redeemed.ok ? "Workspace sign-in is unavailable." : redeemed.error });
          }
          return true;
        }
        let issued: { token: string; session: { id: string; expiresAt: number } };
        try {
          issued = sessions.issuePortal({ email: redeemed.identity.email, grant: redeemed.grant, scopes: scopesForRole(redeemed.identity.role)! });
        } catch {
          sessions.noteFailure(source);
          json(res, 503, { error: "Workspace sign-in is unavailable." });
          return true;
        }
        sessions.clearFailures(source);
        const secure = secureRequest(req);
        res.setHeader("set-cookie", [
          serializeCookie(stateCookieName(req), "", 0, secure),
          serializeCookie(cookieName, issued.token, (issued.session.expiresAt - now()) / 1000, secure),
        ]);
        redirect(res, "/");
        return true;
      }
      return false;
    },

    async authorize(req, auth: RequestAuth): Promise<{ status: 401 | 403 | 503; error: string } | null> {
      void req;
      if (!entitled()) return { status: 503, error: "Workspace sign-in is unavailable." };
      if (auth.kind !== "session") return null;
      const hosted = readHostedConfig(env);
      if (!hosted) return { status: 503, error: "Workspace sign-in is unavailable." };
      if (auth.session.membershipAuthority !== "portal" || !auth.session.email) {
        return { status: 401, error: "Sign in through the workspace portal." };
      }
      if (!sessions.isLive(auth.session.id)) {
        return { status: 401, error: "This sign-in has expired. Sign in through the workspace portal again." };
      }
      // The portal is the authority: recheck the membership on every request.
      const checked = await backchannel(hosted.admin, CHECK_PATH,
        { workspace: hosted.workspace, email: auth.session.email }, fetchImpl);
      if (!checked.ok) {
        if (checked.soft) {
          closeSessionStreams(auth.session.id);
          return { status: 503, error: checked.error };
        }
        sessions.revoke(auth.session.id);
        closeSessionStreams(auth.session.id);
        return { status: 401, error: "This sign-in is no longer valid. Sign in through the workspace portal again." };
      }
      if (checked.identity.email !== auth.session.email) {
        sessions.revoke(auth.session.id);
        closeSessionStreams(auth.session.id);
        return { status: 401, error: "This sign-in is no longer valid. Sign in through the workspace portal again." };
      }
      // Removal or loss of an issued scope ends the session; promotion never widens it.
      const current = scopesForRole(checked.identity.role)!;
      if (auth.session.scopes.some((scope) => !current.includes(scope))) {
        sessions.revoke(auth.session.id);
        closeSessionStreams(auth.session.id);
        return { status: 401, error: "Your workspace role changed. Sign in through the workspace portal again." };
      }
      return null;
    },

    async revalidate(): Promise<void> {
      const hosted = readHostedConfig(env);
      if (!hosted || !entitled()) return;
      for (const session of sessions.list()) {
        if (!sessions.isLive(session.id)) {
          closeSessionStreams(session.id);
          continue;
        }
        // list() carries no authority marker; on a hosted workspace an email
        // address means a portal session (email sign-in stays refused by core).
        if (!session.email) continue;
        const checked = await backchannel(hosted.admin, CHECK_PATH,
          { workspace: hosted.workspace, email: session.email }, fetchImpl);
        if (!checked.ok) {
          // Soft failures close streams but preserve the session for recovery;
          // only the portal's own verdict ends it quietly.
          closeSessionStreams(session.id);
          if (checked.soft) continue;
          sessions.revoke(session.id);
          continue;
        }
        const current = scopesForRole(checked.identity.role)!;
        if (checked.identity.email !== session.email || session.scopes.some((scope) => !current.includes(scope))) {
          sessions.revoke(session.id);
          closeSessionStreams(session.id);
        }
      }
    },
  };
}
