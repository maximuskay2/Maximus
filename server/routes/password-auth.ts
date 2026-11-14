import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";

import { createPasswordAccounts } from "../password-accounts.ts";
import { createPasswordResetMail, type PasswordResetMail } from "../password-reset.ts";
import { json, readBody } from "../harness/http.ts";
import { labelFromUserAgent, requestOrigin, requestSource, serializeSessionCookie } from "../request-auth.ts";
import { cookieMaxAgeSeconds, type SessionRegistry } from "../sessions.ts";
import type { Scope } from "../sessions.ts";
import { SignInMailError } from "../sign-in-mail.ts";
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
  resets?: PasswordResetMail;
  env?: NodeJS.ProcessEnv;
}

const resetMailers = new Map<string, PasswordResetMail>();

/** One mailer per account file, so the link emailed by forgot is the link reset accepts. */
function resetMail(deps: PasswordAuthRouteDeps): PasswordResetMail | null {
  if (deps.resets) return deps.resets;
  const env = deps.env ?? process.env;
  const smtpUrl = env.MAXIMUS_SIGNIN_SMTP_URL?.trim();
  if (!smtpUrl) return null;
  const cached = resetMailers.get(deps.file);
  if (cached) return cached;
  const created = createPasswordResetMail({
    accounts: deps.accounts ?? createPasswordAccounts(deps.file),
    url: smtpUrl,
    from: env.MAXIMUS_SIGNIN_SMTP_FROM,
    origin: () => null,
    file: join(dirname(deps.file), "password-resets.json"),
  });
  resetMailers.set(deps.file, created);
  return created;
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
  const forgot = method === "POST" && path === "/api/auth/password/forgot";
  const reset = method === "POST" && path === "/api/auth/password/reset";
  if (!signup && !signin && !forgot && !reset) return false;
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
  const accounts = deps.accounts ?? createPasswordAccounts(deps.file);

  if (forgot) {
    const email = typeof body?.email === "string" ? body.email : "";
    const env = deps.env ?? process.env;
    const origin = requestOrigin(req) || env.MAXIMUS_PUBLIC_URL?.trim().replace(/\/$/, "") || null;
    const smtpUrl = env.MAXIMUS_SIGNIN_SMTP_URL?.trim();
    if (!smtpUrl) {
      json(res, 503, { error: "Password reset email is not configured on this server." });
      return true;
    }
    const mail = resetMail(deps);
    if (!mail) {
      json(res, 503, { error: "Password reset email is not configured on this server." });
      return true;
    }
    try {
      const result = await mail.request(email, origin);
      if (result === "tooSoon") {
        json(res, 429, userError("serverError.email.tooMany"));
        return true;
      }
    } catch (error) {
      console.warn(`password reset not sent: ${error instanceof Error ? error.message : String(error)}`);
      json(res, 502, userError("serverError.email.unavailable", {
        detail: error instanceof SignInMailError ? error.message : "the mail server refused it",
      }));
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  if (reset) {
    const token = typeof body?.token === "string" ? body.token : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const mail = resetMail(deps);
    if (!mail) {
      json(res, 503, { error: "Password reset is not configured on this server." });
      return true;
    }
    const result = mail.consume(token, password);
    if (!result.ok) {
      if (result.reason === "short-password") {
        json(res, 400, { error: "Use at least 8 characters." });
        return true;
      }
      json(res, 400, { error: "This reset link is invalid or has expired." });
      return true;
    }
    deps.sessions.clearFailures(source);
    json(res, 200, { ok: true, email: result.email });
    return true;
  }

  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
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
