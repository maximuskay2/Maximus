import type { IncomingMessage, ServerResponse } from "node:http";

import { createPasswordAccounts } from "../password-accounts.ts";
import { json, readBody } from "../harness/http.ts";
import { labelFromUserAgent, requestOrigin, requestSource, serializeSessionCookie } from "../request-auth.ts";
import { cookieMaxAgeSeconds, type SessionRegistry } from "../sessions.ts";
import type { Scope } from "../sessions.ts";
import { userError } from "../user-errors.ts";

export interface PasswordAuthRouteDeps {
  file: string;
  cloudHome: boolean;
  hosted: boolean;
  sessions: Pick<SessionRegistry, "attemptAllowed" | "noteFailure" | "clearFailures" | "issue">;
  cookieName: string;
  environment(): unknown;
  onClaim?(email: string): void;
  accounts?: ReturnType<typeof createPasswordAccounts>;
}

function failure(reason: string): { status: number; body: { error: string } } {
  if (reason === "invalid-email") return { status: 400, body: userError("serverError.email.invalid") };
  if (reason === "short-password") return { status: 400, body: { error: "Use at least 8 characters." } };
  if (reason === "taken") return { status: 409, body: { error: "An account with this email already exists." } };
  return { status: 401, body: { error: "That email or password is wrong." } };
}

export async function passwordAuthRoute(deps: PasswordAuthRouteDeps, req: IncomingMessage, res: ServerResponse, path: string, method: string): Promise<boolean> {
  const signup = method === "POST" && path === "/api/auth/signup";
  const signin = method === "POST" && path === "/api/auth/signin";
  if (!signup && !signin) return false;
  if (deps.cloudHome) {
    json(res, 403, { ...userError("serverError.cloud.personal"), code: "cloud_personal" });
    return true;
  }
  if (deps.hosted) {
    json(res, 403, { error: "Sign in through the workspace portal." });
    return true;
  }
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
    json(res, 415, { error: "send the account request as JSON (content-type: application/json)" });
    return true;
  }
  const source = requestSource(req);
  const allowed = deps.sessions.attemptAllowed(source);
  if (!allowed.ok) {
    json(res, 429, userError("serverError.signIn.tooMany", { seconds: Math.ceil(allowed.retryAfterMs / 1000) }));
    return true;
  }
  const body = await readBody(req);
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const accounts = deps.accounts ?? createPasswordAccounts(deps.file);
  const result = signup ? accounts.signup(email, password) : accounts.signin(email, password);
  if (!result.ok) {
    if (result.reason === "wrong" || result.reason === "taken") deps.sessions.noteFailure(source);
    const failed = failure(result.reason);
    json(res, failed.status, failed.body);
    return true;
  }
  deps.sessions.clearFailures(source);
  if (signup && result.owner) deps.onClaim?.(result.email);
  const scopes: Scope[] = result.owner ? ["admin", "client"] : ["client"];
  const label = typeof body?.label === "string" ? body.label : "";
  const issued = deps.sessions.issue({
    label: label.trim() || labelFromUserAgent(req.headers["user-agent"]),
    scopes,
    userId: `account:${result.email}`,
    email: result.email,
  });
  const secure = requestOrigin(req)?.startsWith("https://") === true;
  res.setHeader("set-cookie", serializeSessionCookie(deps.cookieName, issued.token, { secure, maxAgeSeconds: cookieMaxAgeSeconds(issued.session) }));
  json(res, 200, { session: issued.session, environment: deps.environment(), verification: "skipped" });
  return true;
}
