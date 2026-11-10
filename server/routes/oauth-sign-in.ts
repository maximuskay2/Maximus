import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { EmailSignIn } from "../account-signin.ts";
import { json, readBody } from "../harness/http.ts";
import {
  configuredOAuthProviders,
  exchangeOAuthCode,
  isOAuthProvider,
  providerAuthorizeUrl,
  type OAuthProviderId,
} from "../oauth-signin.ts";
import { labelFromUserAgent, requestOrigin, requestSource, serializeSessionCookie } from "../request-auth.ts";
import { cookieMaxAgeSeconds, type PublicSession, type SessionRegistry } from "../sessions.ts";
import { userError } from "../user-errors.ts";

const STATE_TTL_MS = 10 * 60 * 1000;
const TICKET_TTL_MS = 2 * 60 * 1000;

export interface OAuthSignInRouteDeps {
  cloudHome: boolean;
  hosted: boolean;
  emailSignIn: EmailSignIn;
  sessions: Pick<SessionRegistry, "attemptAllowed" | "noteFailure" | "clearFailures" | "issue">;
  cookieName: string;
  environment(): unknown;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface PendingState {
  provider: OAuthProviderId;
  device: boolean;
  exp: number;
}

interface PendingTicket {
  token: string;
  session: PublicSession;
  exp: number;
}

export function createOAuthSignInRoute(deps: OAuthSignInRouteDeps) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const states = new Map<string, PendingState>();
  const tickets = new Map<string, PendingTicket>();

  function sweep() {
    const time = now();
    for (const [key, state] of states) if (state.exp <= time) states.delete(key);
    for (const [key, ticket] of tickets) if (ticket.exp <= time) tickets.delete(key);
  }

  function redirect(res: ServerResponse, location: string) {
    // The provider's code is in this request's URL; no-referrer keeps it off the next page.
    res.writeHead(302, { location, "cache-control": "no-store", "referrer-policy": "no-referrer" });
    res.end();
  }

  return async function oauthSignInRoute(req: IncomingMessage, res: ServerResponse, path: string, method: string): Promise<boolean> {
    const methods = method === "GET" && path === "/api/auth/methods";
    const redeem = method === "POST" && path === "/api/auth/oauth/redeem";
    const flow = method === "GET" ? /^\/api\/auth\/oauth\/([a-z]+)\/(start|callback)$/.exec(path) : null;
    if (!methods && !redeem && !flow) return false;
    if (deps.cloudHome) {
      json(res, 403, { ...userError("serverError.cloud.personal"), code: "cloud_personal" });
      return true;
    }
    if (deps.hosted) {
      json(res, 403, { error: "Sign in through the workspace portal." });
      return true;
    }
    res.setHeader("cache-control", "no-store");
    if (methods) {
      json(res, 200, { methods: configuredOAuthProviders(env) });
      return true;
    }
    const source = requestSource(req);
    const allowed = deps.sessions.attemptAllowed(source);
    if (!allowed.ok) {
      json(res, 429, userError("serverError.signIn.tooMany", { seconds: Math.ceil(allowed.retryAfterMs / 1000) }));
      return true;
    }
    if (redeem) return redeemTicket(req, res, source);
    const provider = flow?.[1] ?? "";
    const step = flow?.[2];
    if (!isOAuthProvider(provider) || !configuredOAuthProviders(env).some((one) => one.id === provider)) {
      json(res, 404, userError("serverError.oauth.notSetUp"));
      return true;
    }
    if (step === "start") return start(req, res, provider);
    return callback(req, res, provider, source);
  };

  function start(req: IncomingMessage, res: ServerResponse, provider: OAuthProviderId): boolean {
    const origin = requestOrigin(req);
    if (!origin) {
      json(res, 400, userError("serverError.oauth.failed"));
      return true;
    }
    sweep();
    const url = new URL(req.url ?? "/", origin);
    const device = url.searchParams.get("device") === "1";
    const state = randomBytes(32).toString("hex");
    states.set(state, { provider, device, exp: now() + STATE_TTL_MS });
    const redirectUri = `${origin}/api/auth/oauth/${provider}/callback`;
    const authorize = providerAuthorizeUrl(provider, { redirectUri, state, env });
    if (!authorize) {
      json(res, 404, userError("serverError.oauth.notSetUp"));
      return true;
    }
    const wantsJson = url.searchParams.get("json") === "1" || String(req.headers.accept ?? "").includes("application/json");
    if (wantsJson) {
      json(res, 200, { url: authorize });
      return true;
    }
    redirect(res, authorize);
    return true;
  }

  async function callback(req: IncomingMessage, res: ServerResponse, provider: OAuthProviderId, source: string): Promise<boolean> {
    const origin = requestOrigin(req);
    const url = new URL(req.url ?? "/", origin ?? "http://localhost");
    const stateKey = url.searchParams.get("state") ?? "";
    sweep();
    const pending = states.get(stateKey);
    states.delete(stateKey);
    const device = pending?.device === true;
    const fail = (message: string) => {
      if (device) redirect(res, `maximus://oauth?error=${encodeURIComponent(message)}`);
      else redirect(res, `/pair?reason=${encodeURIComponent(message)}`);
    };
    if (!origin || !pending || pending.provider !== provider || pending.exp <= now()) {
      deps.sessions.noteFailure(source);
      fail(userError("serverError.oauth.failed").error);
      return true;
    }
    if (url.searchParams.get("error")) {
      deps.sessions.noteFailure(source);
      fail(userError("serverError.oauth.failed").error);
      return true;
    }
    const exchanged = await exchangeOAuthCode({
      provider,
      code: url.searchParams.get("code") ?? "",
      redirectUri: `${origin}/api/auth/oauth/${provider}/callback`,
      env,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });
    if (!exchanged.ok) {
      deps.sessions.noteFailure(source);
      fail(userError(exchanged.reason === "unverified" ? "serverError.oauth.unverified" : "serverError.oauth.failed").error);
      return true;
    }
    const admitted = deps.emailSignIn.admit(exchanged.email, `oauth:${provider}:${exchanged.subject}`);
    if (!admitted.ok) {
      deps.sessions.noteFailure(source);
      fail(admitted.error);
      return true;
    }
    deps.sessions.clearFailures(source);
    const issued = deps.sessions.issue({
      label: labelFromUserAgent(req.headers["user-agent"]),
      scopes: admitted.scopes,
      userId: admitted.userId,
      email: admitted.email,
    });
    if (device) {
      const ticket = randomBytes(32).toString("hex");
      tickets.set(ticket, { token: issued.token, session: issued.session, exp: now() + TICKET_TTL_MS });
      redirect(res, `maximus://oauth?ticket=${ticket}&server=${encodeURIComponent(origin)}`);
      return true;
    }
    const secure = origin.startsWith("https://");
    res.setHeader("set-cookie", serializeSessionCookie(deps.cookieName, issued.token, { secure, maxAgeSeconds: cookieMaxAgeSeconds(issued.session) }));
    redirect(res, "/");
    return true;
  }

  async function redeemTicket(req: IncomingMessage, res: ServerResponse, source: string): Promise<boolean> {
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      json(res, 415, { error: "send the sign-in request as JSON (content-type: application/json)" });
      return true;
    }
    const body = await readBody(req);
    const ticket = typeof body?.ticket === "string" ? body.ticket : "";
    sweep();
    const pending = tickets.get(ticket);
    tickets.delete(ticket);
    if (!pending || pending.exp <= now()) {
      deps.sessions.noteFailure(source);
      json(res, 401, userError("serverError.oauth.failed"));
      return true;
    }
    const secure = requestOrigin(req)?.startsWith("https://") === true;
    res.setHeader("set-cookie", serializeSessionCookie(deps.cookieName, pending.token, {
      secure,
      maxAgeSeconds: cookieMaxAgeSeconds(pending.session),
    }));
    json(res, 200, { session: pending.session, environment: deps.environment() });
    return true;
  }
}
