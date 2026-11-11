import type { Pool } from "pg";
import { z } from "zod";

import { adminAudit, adminInstallations, adminRouting, adminSeats, adminUsage } from "./admin.ts";
import { accountSession, configuredSocialSignIn, createAuth, deleteExpiredVerifications, socialCallbackHandoff } from "./auth.ts";
import { assertContract, contractJSON, MAXIMUS_CONTRACT_VERSION } from "./contract.ts";
import { errorResponse, HTTPError, json, preflight, secureResponse, withBoundedRequestBody } from "./http.ts";
import { getOidcConfig, oidcCallback, putOidcConfig } from "./sso.ts";
import { limitedOTPResponse } from "./otp-rate-limit.ts";
import {
  claimHighLevelFlow,
  HIGHLEVEL_CALLBACK_PATH,
  highLevelCallback,
  refreshHighLevelToken,
  startHighLevelFlow,
} from "./highlevel.ts";
import { registerPushDevice, sendPush, unregisterPushDevice } from "./push.ts";
import { issueRelayToken, relayAdoption } from "./relay.ts";
import {
  appleStoreWebhook,
  googleStoreWebhook,
  storeStatus,
  verifyStorePurchase,
} from "./store-billing.ts";
import {
  createInstallation,
  installationSelf,
  listInstallations,
  revokeInstallation,
  rotateInstallationCredential,
} from "./installations.ts";
import type { AccountsConfig, AccountsEnv, JobContext } from "./types.ts";
import {
  acceptInvite,
  applyBillingEvent,
  getEntitlements,
  getOperatorProviders,
  getSpend,
  getWorkspace,
  getWorkspaceProviders,
  invite,
  issueWorkspaceToken,
  listMemberships,
  revoke,
  signup,
  updateOperatorProviders,
  updateWorkspace,
  updateWorkspaceProviders,
} from "./workspaces.ts";
import { getOperatorMail, putOperatorMail } from "./operator-mail.ts";
import { updatePlanCatalog } from "./plan-catalog.ts";

const SIGN_IN_OTP_PATH = "/api/auth/sign-in/email-otp";
const ROTATE_ROUTE = /^\/v1\/installations\/([^/]+)\/credentials\/rotate$/;
const INSTALLATION_ROUTE = /^\/v1\/installations\/([^/]+)$/;
const WORKSPACE_ROUTE = /^\/api\/workspaces\/([^/]+)$/;
const WORKSPACE_PROVIDERS_ROUTE = /^\/api\/workspaces\/([^/]+)\/providers$/;
const WORKSPACE_PROVIDER_ROUTE = /^\/api\/workspaces\/([^/]+)\/providers\/([^/]+)$/;
const WORKSPACE_ENTITLEMENTS_ROUTE = /^\/api\/workspaces\/([^/]+)\/entitlements$/;
const WORKSPACE_SPEND_ROUTE = /^\/api\/workspaces\/([^/]+)\/spend$/;
const WORKSPACE_TOKEN_ROUTE = /^\/api\/workspaces\/([^/]+)\/token$/;
const OPERATOR_PROVIDERS_ROUTE = /^\/api\/operator\/providers$/;
const OPERATOR_PROVIDER_ROUTE = /^\/api\/operator\/providers\/([^/]+)$/;

const BETTER_AUTH_ERROR_CODES = new Map([
  ["INVALID_EMAIL", "invalid_email"],
  ["INVALID_OTP", "invalid_otp"],
  ["OTP_EXPIRED", "otp_expired"],
  ["TOO_MANY_ATTEMPTS", "rate_limited"],
  ["USER_NOT_FOUND", "invalid_otp"],
  ["VALIDATION_ERROR", "invalid_request"],
]);
const betterAuthErrorSchema = z.object({ code: z.string() }).loose();

function authStatusErrorCode(status: number): string {
  if (status === 400 || status === 422) return "invalid_request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 405) return "method_not_allowed";
  if (status === 409) return "conflict";
  if (status === 413) return "request_too_large";
  if (status === 415) return "unsupported_media_type";
  if (status === 429) return "rate_limited";
  return "request_failed";
}

async function canonicalAuthResponse(response: Response): Promise<Response> {
  if (response.status >= 500) return errorResponse(500, "internal_error");
  if (response.status < 400 || response.status > 499) return response;
  const payload: unknown = await response.json().catch(() => null);
  const parsed = betterAuthErrorSchema.safeParse(payload);
  const dependencyCode = parsed.success ? parsed.data.code : "";
  const code = BETTER_AUTH_ERROR_CODES.get(dependencyCode) ?? authStatusErrorCode(response.status);
  return errorResponse(response.status, code);
}

export interface RouterDeps {
  env: AccountsEnv;
  ctx: JobContext;
  config: AccountsConfig;
  pool: Pool;
  requestId: string;
  cronSecret: string;
  apnsFetch?: typeof fetch;
  highLevelFetch?: typeof fetch;
  ssoFetch?: typeof fetch;
}

function cronAuthorized(request: Request, cronSecret: string): boolean {
  const presented = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  return presented !== undefined && presented.length === cronSecret.length
    && ((): boolean => {
      let diff = 0;
      for (let i = 0; i < presented.length; i += 1) diff |= presented.charCodeAt(i) ^ cronSecret.charCodeAt(i);
      return diff === 0;
    })();
}

async function route(request: Request, deps: RouterDeps): Promise<Response> {
  const { env, ctx, config, pool, requestId } = deps;
  const apnsFetch = deps.apnsFetch ?? fetch;
  const highLevelFetch = deps.highLevelFetch ?? fetch;
  const ssoFetch = deps.ssoFetch ?? fetch;
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return preflight(request, config);

  if (request.method === "GET" && url.pathname === "/api/health") {
    return contractJSON({ ok: true, service: "maximus-control-plane", contractVersion: MAXIMUS_CONTRACT_VERSION });
  }

  if (request.method === "POST" && url.pathname === "/internal/cron") {
    if (!cronAuthorized(request, deps.cronSecret)) return errorResponse(401, "unauthorized");
    const auth = createAuth(env, ctx, config, requestId, pool);
    await deleteExpiredVerifications(auth);
    return json({ ok: true });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/signup") {
    assertContract(request);
    return signup(request, env, createAuth(env, ctx, config, requestId, pool));
  }
  if (request.method === "GET" && url.pathname === "/api/auth/memberships") {
    assertContract(request);
    return listMemberships(request, env, createAuth(env, ctx, config, requestId, pool));
  }
  if (request.method === "POST" && url.pathname === "/api/auth/invite") {
    assertContract(request);
    return invite(request, env, createAuth(env, ctx, config, requestId, pool));
  }
  if (request.method === "POST" && url.pathname === "/api/auth/invite/accept") {
    assertContract(request);
    return acceptInvite(request, env, createAuth(env, ctx, config, requestId, pool));
  }
  if (request.method === "POST" && url.pathname === "/api/auth/revoke") {
    assertContract(request);
    return revoke(request, env, createAuth(env, ctx, config, requestId, pool));
  }
  if (url.pathname === "/api/auth/oidc/config") {
    assertContract(request);
    if (request.method === "GET") return getOidcConfig(request, env, createAuth(env, ctx, config, requestId, pool));
    if (request.method === "PUT") return putOidcConfig(request, env, createAuth(env, ctx, config, requestId, pool));
  }
  if (request.method === "POST" && url.pathname === "/api/auth/oidc/callback") {
    assertContract(request);
    return oidcCallback(request, env, createAuth(env, ctx, config, requestId, pool), { fetchImpl: ssoFetch });
  }

  if (request.method === "GET" && url.pathname === "/api/auth/methods") {
    return json({ methods: [{ id: "email", label: "Email" }, ...configuredSocialSignIn(env)] });
  }

  if (url.pathname.startsWith("/api/auth/")) {
    const limited = await limitedOTPResponse(request, env);
    if (limited) return limited;
    const auth = createAuth(env, ctx, config, requestId, pool);
    const response = await auth.handler(request);
    if (request.method === "GET" && url.pathname.startsWith("/api/auth/callback/")) {
      const handed = await socialCallbackHandoff(response, auth, config.allowedOrigins);
      if (handed) return handed;
    }
    if (
      request.method === "POST"
      && url.pathname === SIGN_IN_OTP_PATH
      && response.status !== 429
      && response.status < 500
    ) {
      ctx.waitUntil(deleteExpiredVerifications(auth).catch(() => {
        console.error(JSON.stringify({
          message: "expired verification sweep failed",
          requestId,
          errorCode: "auth_internal",
        }));
      }));
    }
    return canonicalAuthResponse(response);
  }

  const auth = createAuth(env, ctx, config, requestId, pool);

  const workspaceProviders = url.pathname.match(WORKSPACE_PROVIDERS_ROUTE);
  if (workspaceProviders && (request.method === "GET" || request.method === "PUT")) {
    assertContract(request);
    return request.method === "GET"
      ? getWorkspaceProviders(request, workspaceProviders[1], env, auth)
      : updateWorkspaceProviders(request, workspaceProviders[1], null, env, auth);
  }
  const workspaceProvider = url.pathname.match(WORKSPACE_PROVIDER_ROUTE);
  if (workspaceProvider && request.method === "PUT") {
    assertContract(request);
    return updateWorkspaceProviders(request, workspaceProvider[1], workspaceProvider[2], env, auth);
  }
  const workspaceEntitlements = url.pathname.match(WORKSPACE_ENTITLEMENTS_ROUTE);
  if (workspaceEntitlements && request.method === "GET") {
    assertContract(request);
    return getEntitlements(request, workspaceEntitlements[1], env, auth);
  }
  const workspaceSpend = url.pathname.match(WORKSPACE_SPEND_ROUTE);
  if (workspaceSpend && request.method === "GET") {
    assertContract(request);
    return getSpend(request, workspaceSpend[1], env, auth);
  }
  const workspaceToken = url.pathname.match(WORKSPACE_TOKEN_ROUTE);
  if (workspaceToken && request.method === "POST") {
    assertContract(request);
    return issueWorkspaceToken(request, workspaceToken[1], env, auth);
  }
  const workspace = url.pathname.match(WORKSPACE_ROUTE);
  if (workspace && (request.method === "GET" || request.method === "PUT")) {
    assertContract(request);
    return request.method === "GET"
      ? getWorkspace(request, workspace[1], env, auth)
      : updateWorkspace(request, workspace[1], env, auth);
  }
  if (url.pathname === "/api/operator/mail" && (request.method === "GET" || request.method === "PUT")) {
    assertContract(request);
    return request.method === "GET" ? getOperatorMail(request, env) : putOperatorMail(request, env);
  }
  if (request.method === "GET" && OPERATOR_PROVIDERS_ROUTE.test(url.pathname)) {
    assertContract(request);
    return getOperatorProviders(request, env, auth);
  }
  if (request.method === "PUT" && url.pathname === "/api/operator/plans") {
    assertContract(request);
    return updatePlanCatalog(request, env);
  }
  if (request.method === "PUT" && OPERATOR_PROVIDERS_ROUTE.test(url.pathname)) {
    assertContract(request);
    return updateOperatorProviders(request, null, env);
  }
  const operatorProvider = url.pathname.match(OPERATOR_PROVIDER_ROUTE);
  if (operatorProvider && request.method === "PUT") {
    assertContract(request);
    return updateOperatorProviders(request, operatorProvider[1], env);
  }
  if (request.method === "GET" && url.pathname === "/api/admin/seats") {
    assertContract(request);
    return adminSeats(request, env, auth);
  }
  if (request.method === "GET" && url.pathname === "/api/admin/installations") {
    assertContract(request);
    return adminInstallations(request, env, auth);
  }
  if (request.method === "GET" && url.pathname === "/api/admin/audit") {
    assertContract(request);
    return adminAudit(request, env, auth);
  }
  if (request.method === "GET" && url.pathname === "/api/admin/usage") {
    assertContract(request);
    return adminUsage(request, env, auth);
  }
  if (request.method === "GET" && url.pathname === "/api/admin/routing") {
    assertContract(request);
    return adminRouting(request, env, auth);
  }
  if (request.method === "POST" && url.pathname === "/api/billing/store/verify") {
    return verifyStorePurchase(request, env, auth, (event) => applyBillingEvent(env, event));
  }
  if (request.method === "GET" && url.pathname === "/api/billing/store/status") {
    return storeStatus(request, env, auth);
  }
  if (request.method === "POST" && url.pathname === "/api/billing/webhook/apple") {
    return appleStoreWebhook(request, env, (event) => applyBillingEvent(env, event));
  }
  if (request.method === "POST" && url.pathname === "/api/billing/webhook/google") {
    return googleStoreWebhook(request, env, (event) => applyBillingEvent(env, event));
  }

  if (request.method === "GET" && url.pathname === "/v1/me") {
    const session = await accountSession(request, auth);
    if (!session) throw new HTTPError(401, "unauthorized");
    return json({
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        emailVerified: session.user.emailVerified,
      },
    });
  }
  if (request.method === "GET" && url.pathname === "/v1/installations") {
    return listInstallations(request, env, auth);
  }
  if (request.method === "POST" && url.pathname === "/v1/installations") {
    return createInstallation(request, env, auth);
  }
  if (request.method === "GET" && url.pathname === "/v1/installations/self") {
    return installationSelf(request, env);
  }

  if (request.method === "POST" && url.pathname === "/v1/installations/self/relay-token") {
    return issueRelayToken(request, env);
  }

  if (request.method === "POST" && url.pathname === "/v1/installations/self/push/register") {
    return registerPushDevice(request, env);
  }
  if (request.method === "POST" && url.pathname === "/v1/installations/self/push/unregister") {
    return unregisterPushDevice(request, env);
  }
  if (request.method === "POST" && url.pathname === "/v1/installations/self/push/send") {
    return sendPush(request, env, apnsFetch, requestId);
  }

  if (request.method === "POST" && url.pathname === "/v1/highlevel/start") {
    return startHighLevelFlow(request, env);
  }
  if (request.method === "GET" && url.pathname === HIGHLEVEL_CALLBACK_PATH) {
    return highLevelCallback(request, env, highLevelFetch, requestId);
  }
  if (request.method === "POST" && url.pathname === "/v1/highlevel/claim") {
    return claimHighLevelFlow(request, env);
  }
  if (request.method === "POST" && url.pathname === "/v1/highlevel/refresh") {
    return refreshHighLevelToken(request, env, highLevelFetch, requestId);
  }

  const rotate = url.pathname.match(ROTATE_ROUTE);
  if (request.method === "POST" && rotate) {
    return rotateInstallationCredential(request, rotate[1], env, auth);
  }
  const installation = url.pathname.match(INSTALLATION_ROUTE);
  if (request.method === "DELETE" && installation) {
    return revokeInstallation(request, installation[1], env, auth);
  }
  return errorResponse(404, "not_found");
}

export async function handleRequest(request: Request, deps: RouterDeps): Promise<Response> {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/healthz") {
    const adoption = await relayAdoption(deps.env).catch(() => null);
    return secureResponse(json({
      ok: true,
      service: "maximus-control-plane",
      ...(adoption === null ? {} : { relayAdoption: adoption }),
    }), request, null, requestId);
  }
  try {
    const origin = request.headers.get("origin");
    const publicNavigation = request.method === "GET" && url.pathname === HIGHLEVEL_CALLBACK_PATH;
    if (origin && !publicNavigation && !deps.config.allowedOrigins.has(origin)) {
      return secureResponse(errorResponse(403, "origin_not_allowed"), request, deps.config, requestId);
    }
    const boundedRequest = await withBoundedRequestBody(request);
    return secureResponse(
      await route(boundedRequest, { ...deps, requestId }),
      request,
      deps.config,
      requestId,
    );
  } catch (error) {
    if (error instanceof HTTPError) {
      return secureResponse(errorResponse(error.status, error.code), request, deps.config, requestId);
    }
    console.error(JSON.stringify({ message: "request failed", requestId }));
    return secureResponse(errorResponse(500, "internal_error"), request, deps.config, requestId);
  }
}
