// Managed gateway (server side): the ONLY place our bundled provider keys
// live. A workspace arrives with its per-workspace token and an assigned
// model; the gateway authenticates the token, re-enforces the assigned-model
// catalog (never trusting the client), attaches OUR provider key, forwards to
// the provider's native API, and meters the turn as `via: "bundled"`.
// BYO traffic never reaches this module — it uses user credentials directly —
// and our keys never leave it.
import { timingSafeEqual } from "node:crypto";

import { ledgerCost } from "../model-prices.ts";
import type { PriceList } from "../prices.ts";
import { instanceProvider, PROVIDER_IDS, resolveProvider, switchboardSelectionRefusal, type ProviderId, type SwitchboardPolicies } from "../switchboard.ts";
import { appendUsage } from "../usage-ledger.ts";
import { assertWithinBundledBudget, type BundledBudgetState } from "./allowance.ts";

export const GATEWAY_BASE_PATH = "/api/gateway";
export const GATEWAY_TOKEN_PATTERN = /^maximus_workspace_[A-Za-z0-9_-]{43}$/;
const WORKSPACE_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;

// Upstream pins mirror the switchboard comments (verified against official
// provider docs at build time by the switchboard track):
//  Anthropic: https://docs.anthropic.com/en/api/overview
//  OpenAI: https://developers.openai.com/api/docs
//  xAI: https://docs.x.ai/developers/models
//  Kimi: https://platform.kimi.ai/docs/api/chat.md (OpenAI-compatible base)
//  Meta: https://dev.meta.ai/docs/protocols (OpenAI-compatible base)
const UPSTREAM: Readonly<Record<ProviderId, { base: string; keyEnv: string; auth: (key: string) => Record<string, string> }>> = {
  claude: { base: "https://api.anthropic.com", keyEnv: "MAXIMUS_GATEWAY_ANTHROPIC_KEY", auth: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }) },
  codex: { base: "https://api.openai.com/v1", keyEnv: "MAXIMUS_GATEWAY_OPENAI_KEY", auth: (key) => ({ authorization: `Bearer ${key}` }) },
  grok: { base: "https://api.x.ai/v1", keyEnv: "MAXIMUS_GATEWAY_XAI_KEY", auth: (key) => ({ authorization: `Bearer ${key}` }) },
  kimi: { base: "https://api.moonshot.ai/v1", keyEnv: "MAXIMUS_GATEWAY_MOONSHOT_KEY", auth: (key) => ({ authorization: `Bearer ${key}` }) },
  muse: { base: "https://api.meta.ai/v1", keyEnv: "MAXIMUS_GATEWAY_META_KEY", auth: (key) => ({ authorization: `Bearer ${key}` }) },
};

export const GATEWAY_KEY_ENVS = Object.values(UPSTREAM).map((entry) => entry.keyEnv);

export interface GatewayRoute {
  workspace: string;
  provider: ProviderId;
  upstreamPath: string;
}

/** `{base}/{provider}/{...upstream-path}` (contracts section 7); null when the path is not a gateway route. */
export function parseGatewayRoute(path: string): GatewayRoute | null {
  const match = /^\/api\/gateway\/([a-z][a-z0-9-]{1,30})\/([a-z]+)(\/.*)?$/.exec(path);
  if (!match) return null;
  const provider = match[2]!;
  if (!(PROVIDER_IDS as readonly string[]).includes(provider)) return null;
  const upstreamPath = match[3] || "/";
  if (upstreamPath.includes("..") || upstreamPath.includes("\\")) return null;
  return { workspace: match[1]!, provider: provider as ProviderId, upstreamPath };
}

export function extractBearerToken(headers: Record<string, string | undefined>): string | null {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "authorization" && value) {
      const token = /^Bearer\s+(.+)$/i.exec(value.trim())?.[1]?.trim();
      return token || null;
    }
  }
  return null;
}

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};

/** Resolves a workspace token to its workspace; null authenticates nothing. */
export interface GatewayTokenStore {
  workspaceFor(token: string): string | null;
}

/** Operator config: `MAXIMUS_GATEWAY_TOKENS` JSON `{"workspace":"maximus_workspace_…"}` (harness-side, 0600 file or env). */
export function tokenStoreFromEnv(env: NodeJS.ProcessEnv = process.env): GatewayTokenStore {
  let entries: Array<[string, string]> = [];
  try {
    const parsed: unknown = JSON.parse(env.MAXIMUS_GATEWAY_TOKENS ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [workspace, token] of Object.entries(parsed as Record<string, unknown>)) {
        if (WORKSPACE_PATTERN.test(workspace) && typeof token === "string" && GATEWAY_TOKEN_PATTERN.test(token)) {
          entries.push([workspace, token]);
        }
      }
    }
  } catch {
    entries = [];
  }
  return {
    workspaceFor(token: string): string | null {
      if (!GATEWAY_TOKEN_PATTERN.test(token)) return null;
      for (const [workspace, expected] of entries) {
        if (safeEqual(token, expected)) return workspace;
      }
      return null;
    },
  };
}

/** Every header that could carry a user credential: none of these ever cross the gateway to upstream. */
export const USER_CREDENTIAL_HEADERS = [
  "authorization", "x-api-key", "anthropic-api-key", "api-key",
  "openai-api-key", "xai-api-key", "moonshot-api-key", "meta-api-key",
  "cookie", "set-cookie", "proxy-authorization",
];

export function stripUserCredentials(headers: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (USER_CREDENTIAL_HEADERS.includes(name.toLowerCase())) continue;
    out[name.toLowerCase()] = value;
  }
  return out;
}

/** Gateway side: BYO credentials must never arrive here (the workspace sends only its gateway token). */
export function assertNoUserCredentials(headers: Record<string, string | undefined>, token: string): void {
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || value === "" || value === token || value === `Bearer ${token}`) continue;
    if (USER_CREDENTIAL_HEADERS.includes(name.toLowerCase())) {
      throw Object.assign(new Error("user credentials are never sent to the managed gateway"), { status: 400, code: "gateway_isolation" });
    }
  }
}

/** Workspace side: our bundled provider keys must never be visible here. */
export function assertNoOperatorKeys(env: NodeJS.ProcessEnv): void {
  const leaked = GATEWAY_KEY_ENVS.filter((name) => env[name]);
  if (leaked.length) throw new Error(`operator gateway keys must never reach a workspace (${leaked.join(", ")})`);
}

export type GatewayRouteDecision =
  | { via: "byo" }
  | { via: "bundled"; models: string[] }
  | { via: "refused"; reason: string };

/** Mixed mode falls out of the switchboard: each provider resolves independently to BYO, bundled, or refused. */
export function routeTurn(
  selection: { instanceId: string; model: string },
  options: { policies?: SwitchboardPolicies; env?: NodeJS.ProcessEnv; gatewayEntitled?: boolean } = {},
): GatewayRouteDecision {
  const providerId = instanceProvider(selection.instanceId);
  if (!providerId) return { via: "byo" };
  const policies = options.policies;
  const env = options.env ?? process.env;
  const refusal = switchboardSelectionRefusal(selection, policies, env);
  if (refusal) return { via: "refused", reason: refusal };
  const verdict = resolveProvider(providerId, policies, env);
  if (verdict.mode !== "bundled") return { via: "byo" };
  if (options.gatewayEntitled === false) {
    return {
      via: "refused",
      reason: "LLM-included routing needs the gateway entitlement. Upgrade to route this provider through the managed gateway.",
    };
  }
  return { via: "bundled", models: [...(verdict.models ?? [])] };
}

export interface MeteredTurn {
  workspace: string;
  provider: ProviderId;
  model: string;
  input: number;
  output: number;
  cachedInput?: number;
}

export interface GatewayForwardDeps {
  tokens?: GatewayTokenStore;
  /** Assigned-model catalog for (workspace, provider); null means no bundled assignment. */
  catalog?: (workspace: string, provider: ProviderId) => string[] | null;
  keys?: (envName: string) => string | undefined;
  fetchImpl?: typeof fetch;
  book?: (turn: MeteredTurn) => void;
  budget?: () => BundledBudgetState | null;
  dataDir?: string;
  prices?: () => PriceList | null;
}

export interface GatewayForwardResult {
  status: number;
  contentType: string;
  body: string;
  metered: MeteredTurn | null;
}

const cleanCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

function modelFromBody(rawBody: string): string | null {
  try {
    const model: unknown = (JSON.parse(rawBody) as { model?: unknown }).model;
    return typeof model === "string" && model ? model : null;
  } catch {
    return null;
  }
}

function usageFromUpstream(provider: ProviderId, body: string): { input: number; output: number; cachedInput: number } | null {
  try {
    const usage = (JSON.parse(body) as { usage?: Record<string, unknown> }).usage;
    if (!usage || typeof usage !== "object") return null;
    const details = usage.prompt_tokens_details ?? usage.input_tokens_details;
    const cachedInput = details && typeof details === "object"
      ? cleanCount((details as { cached_tokens?: unknown }).cached_tokens)
      : cleanCount(usage.cached_tokens);
    if (provider === "claude") {
      return { input: cleanCount(usage.input_tokens), output: cleanCount(usage.output_tokens), cachedInput };
    }
    return { input: cleanCount(usage.prompt_tokens), output: cleanCount(usage.completion_tokens), cachedInput };
  } catch {
    return null;
  }
}

const MANAGED_ERROR = "This model is not assigned to this workspace. Choose one of its company models.";

export async function forwardBundledRequest(
  request: { method: string; path: string; headers: Record<string, string | undefined>; rawBody: string },
  deps: GatewayForwardDeps = {},
): Promise<GatewayForwardResult> {
  const fail = (status: number, error: string, code?: string): GatewayForwardResult => {
    if (code) return { status, contentType: "application/json", body: JSON.stringify({ error, code }), metered: null };
    return { status, contentType: "application/json", body: JSON.stringify({ error }), metered: null };
  };
  if (request.method !== "GET" && request.method !== "POST") return fail(405, "Gateway accepts GET and POST requests");
  const route = parseGatewayRoute(request.path);
  if (!route) return fail(404, "Unknown gateway route");
  const tokens = deps.tokens ?? tokenStoreFromEnv();
  const token = extractBearerToken(request.headers);
  const workspace = token ? tokens.workspaceFor(token) : null;
  if (!token || workspace !== route.workspace) return fail(401, "Invalid workspace token");
  try {
    assertNoUserCredentials(request.headers, token);
  } catch (error) {
    return fail(400, error instanceof Error ? error.message : "Isolation refusal", "gateway_isolation");
  }
  const catalog = deps.catalog?.(route.workspace, route.provider) ?? null;
  if (!catalog) return fail(403, MANAGED_ERROR);
  const model = request.method === "POST" ? modelFromBody(request.rawBody) : "models-list";
  if (request.method === "POST" && (!model || !catalog.includes(model))) return fail(403, MANAGED_ERROR);
  const budget = deps.budget?.() ?? null;
  if (budget) {
    try {
      assertWithinBundledBudget(budget);
    } catch (error) {
      const shaped = error as Error & { status?: number; code?: string };
      return fail(shaped.status ?? 409, shaped.message, shaped.code);
    }
  }
  const upstream = UPSTREAM[route.provider];
  const key = (deps.keys ?? ((name: string) => process.env[name]))(upstream.keyEnv);
  if (!key) return fail(503, "This provider is not configured on the managed gateway");
  const fetchImpl = deps.fetchImpl ?? fetch;
  const headers = { ...stripUserCredentials(request.headers), ...upstream.auth(key) };
  delete headers["content-length"];
  delete headers.host;
  const upstreamResponse = await fetchImpl(`${upstream.base}${route.upstreamPath}`, {
    method: request.method,
    headers: { ...headers, "content-type": "application/json" },
    ...(request.method === "POST" ? { body: request.rawBody } : {}),
  });
  const body = await upstreamResponse.text();
  const contentType = upstreamResponse.headers.get("content-type")?.split(";")[0]?.trim() || "application/json";
  if (!upstreamResponse.ok) return { status: upstreamResponse.status, contentType, body, metered: null };
  const usage = model && model !== "models-list" ? usageFromUpstream(route.provider, body) : null;
  const metered: MeteredTurn | null = usage && model ? {
    workspace: route.workspace, provider: route.provider, model, input: usage.input, output: usage.output,
    ...(usage.cachedInput > 0 ? { cachedInput: usage.cachedInput } : {}),
  } : null;
  if (metered) {
    if (deps.book) deps.book(metered);
    else if (deps.dataDir) defaultBook(deps.dataDir, metered, deps.prices?.() ?? null);
  }
  return { status: upstreamResponse.status, contentType, body, metered };
}

function defaultBook(dataDir: string, turn: MeteredTurn, prices: PriceList | null): void {
  const driverKind = turn.provider;
  const { costUsd, costSource } = ledgerCost({ driverKind, model: turn.model, input: turn.input, output: turn.output, costUsd: null }, prices);
  void appendUsage(dataDir, {
    botId: "gateway",
    botName: "Managed gateway",
    threadId: `gateway:${turn.workspace}`,
    instanceId: turn.provider,
    driverKind,
    model: turn.model,
    input: turn.input,
    output: turn.output,
    costUsd,
    ...(costSource ? { costSource } : {}),
    trigger: { kind: "owner" },
    via: "bundled",
  });
}
