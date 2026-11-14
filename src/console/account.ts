// Console account client: hosted signup, invites, and workspace admin through
// the harness proxy (/api/console/*). The account token comes from email OTP
// and lives in session storage: it dies with the tab and is revocable
// server-side. Amounts arrive from operator configuration, never code.
export class ConsoleError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ConsoleError";
    this.status = status;
    this.code = code;
  }
}

export type ConsoleFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ConsoleCallOptions {
  fetchImpl?: ConsoleFetch;
  timeoutMs?: number;
}

async function call<T>(path: string, options: ConsoleCallOptions & { method?: string; token?: string; body?: unknown }): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const res = await fetchImpl(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
  if (!res.ok) {
    const message = typeof payload.error === "string" ? payload.error : `Request failed (${res.status})`;
    throw new ConsoleError(message, res.status, typeof payload.code === "string" ? payload.code : "request_failed");
  }
  return payload as T;
}

export interface ConsoleAccount {
  token: string;
  email: string;
}

export interface AccountStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const ACCOUNT_KEY = "maximus.console.account";

export function createAccountStore(storage: AccountStorage | null): {
  load(): ConsoleAccount | null;
  save(account: ConsoleAccount): void;
  clear(): void;
} {
  return {
    load(): ConsoleAccount | null {
      try {
        const raw = storage?.getItem(ACCOUNT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<ConsoleAccount>;
        if (typeof parsed.token !== "string" || typeof parsed.email !== "string" || !parsed.token || !parsed.email) return null;
        return { token: parsed.token, email: parsed.email };
      } catch {
        return null;
      }
    },
    save(account: ConsoleAccount): void {
      storage?.setItem(ACCOUNT_KEY, JSON.stringify(account));
    },
    clear(): void {
      storage?.removeItem(ACCOUNT_KEY);
    },
  };
}

export const consoleAccount =
  createAccountStore(typeof sessionStorage === "undefined" ? null : sessionStorage);

export function normalizeConsoleEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Mirrors the server's account-email rule so the form refuses before a round trip. */
export function validConsoleEmail(value: string): boolean {
  return /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/.test(value.trim());
}

export function validWorkspaceId(value: string): boolean {
  return /^[a-z][a-z0-9-]{1,30}$/.test(value.trim());
}

export function validOtpCode(value: string): boolean {
  return /^\d{8}$/.test(value.trim());
}

export interface OtpUser {
  id: string;
  email: string;
}

export interface SignInMethod {
  id: string;
  label: string;
}

export function signInMethods(options?: ConsoleCallOptions): Promise<{ methods: SignInMethod[] }> {
  return call("/api/console/auth/methods", options ?? {});
}

export function startSocial(provider: string, callbackURL: string, options?: ConsoleCallOptions): Promise<{ url: string }> {
  return call("/api/console/auth/social", { ...options, method: "POST", body: { provider, callbackURL } });
}

/** The control plane returns the account in the fragment so it is not sent to the next server. */
export function socialAccountFromHash(hash: string): ConsoleAccount | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("account")?.trim() ?? "";
  const email = normalizeConsoleEmail(params.get("email") ?? "");
  if (!token || token.length > 4096 || /\s/.test(token) || !validConsoleEmail(email)) return null;
  return { token, email };
}

export function startOtp(email: string, options?: ConsoleCallOptions): Promise<{ email: string }> {
  return call("/api/console/auth/otp/start", { ...options, method: "POST", body: { email } });
}

export function verifyOtp(email: string, code: string, options?: ConsoleCallOptions): Promise<{ token: string; user: OtpUser }> {
  return call("/api/console/auth/otp/verify", { ...options, method: "POST", body: { email, code } });
}

export interface ConsoleWorkspace {
  id: string;
  displayName: string;
  plan: string;
  role: string;
  status: string;
}

export function createWorkspace(
  token: string,
  input: { workspace: string; displayName?: string; plan?: string },
  options?: ConsoleCallOptions,
): Promise<{ workspace: ConsoleWorkspace }> {
  return call("/api/console/workspaces", { ...options, method: "POST", token, body: input });
}

export function acceptInvite(token: string, inviteToken: string, options?: ConsoleCallOptions): Promise<{ workspace: ConsoleWorkspace }> {
  return call("/api/console/invites/accept", { ...options, method: "POST", token, body: { token: inviteToken } });
}

export interface ConsoleInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: string | null;
}

export function sendInvite(
  token: string,
  input: { workspace: string; email: string; role: "admin" | "member" },
  options?: ConsoleCallOptions,
): Promise<{ invite: ConsoleInvite; token: string }> {
  return call("/api/console/invites", { ...options, method: "POST", token, body: input });
}

export function revokeInvite(
  token: string,
  input: { workspace: string; userId?: string; inviteId?: string },
  options?: ConsoleCallOptions,
): Promise<{ ok: boolean }> {
  return call("/api/console/invites/revoke", { ...options, method: "POST", token, body: input });
}

export interface WorkspaceProviderState {
  id: string;
  mode: "off" | "byo" | "bundled";
  models: string[];
  reason?: string;
}

export interface ProviderRoutingState {
  allowed: boolean;
  via: "off" | "byo" | "bundled";
  reason?: string;
  models?: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function providerMode(value: unknown): WorkspaceProviderState["mode"] {
  return value === "bundled" || value === "off" ? value : "byo";
}

/** The worker answers providers as a record keyed by provider id; views need a stable array. Unknown ids never render. */
export function toProviderStates(payload: unknown): { providers: WorkspaceProviderState[]; routing: Record<string, ProviderRoutingState> } {
  const providers = asRecord(asRecord(payload).providers);
  const routes = asRecord(asRecord(payload).routing);
  const states: WorkspaceProviderState[] = [];
  const routing: Record<string, ProviderRoutingState> = {};
  for (const [id, entry] of Object.entries(providers)) {
    if (!/^[a-z]+$/.test(id)) continue;
    const record = asRecord(entry);
    const models = Array.isArray(record.models) ? record.models.filter((model): model is string => typeof model === "string") : [];
    const route = asRecord(routes[id]);
    const reason = typeof route.reason === "string" && route.reason ? route.reason : undefined;
    states.push({ id, mode: providerMode(record.mode), models, ...(reason ? { reason } : {}) });
    // PUT answers carry no routing: only repeat verdicts the server actually sent.
    if (!Object.hasOwn(routes, id)) continue;
    routing[id] = {
      allowed: route.allowed === true,
      via: route.via === "bundled" || route.via === "byo" ? route.via : "off",
      ...(reason ? { reason } : {}),
      ...(Array.isArray(route.models) ? { models: route.models.filter((model): model is string => typeof model === "string") } : {}),
    };
  }
  states.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { providers: states, routing };
}

export function workspaceProviders(token: string, id: string, options?: ConsoleCallOptions): Promise<{ providers: WorkspaceProviderState[]; routing: Record<string, ProviderRoutingState> }> {
  return call<unknown>(`/api/console/workspaces/${id}/providers`, { ...options, token }).then(toProviderStates);
}

export interface ProviderUpdate {
  mode: "off" | "byo" | "bundled";
  models?: string[];
}

export function setWorkspaceProviders(
  token: string,
  id: string,
  body: Record<string, ProviderUpdate>,
  options?: ConsoleCallOptions,
): Promise<{ providers: WorkspaceProviderState[]; routing: Record<string, ProviderRoutingState> }> {
  return call<unknown>(`/api/console/workspaces/${id}/providers`, { ...options, method: "PUT", token, body }).then(toProviderStates);
}

export function setWorkspaceProvider(
  token: string,
  id: string,
  providerId: string,
  body: ProviderUpdate,
  options?: ConsoleCallOptions,
): Promise<{ providers: WorkspaceProviderState[]; routing: Record<string, ProviderRoutingState> }> {
  return call<unknown>(`/api/console/workspaces/${id}/providers/${providerId}`, { ...options, method: "PUT", token, body }).then(toProviderStates);
}

export function getConsoleWorkspace(token: string, id: string, options?: ConsoleCallOptions): Promise<{ workspace: ConsoleWorkspace }> {
  return call(`/api/console/workspaces/${id}`, { ...options, token });
}

export function workspaceEntitlements(token: string, id: string, options?: ConsoleCallOptions): Promise<Record<string, unknown>> {
  return call(`/api/console/workspaces/${id}/entitlements`, { ...options, token });
}

export function workspaceSpend(token: string, id: string, options?: ConsoleCallOptions): Promise<Record<string, unknown>> {
  return call(`/api/console/workspaces/${id}/spend`, { ...options, token });
}

export function workspaceSeats(token: string, id: string, options?: ConsoleCallOptions): Promise<Record<string, unknown>> {
  return call(`/api/console/admin/seats?workspace=${encodeURIComponent(id)}`, { ...options, token });
}

function adminView(token: string, view: "installations" | "audit" | "usage" | "routing", id: string, options?: ConsoleCallOptions): Promise<Record<string, unknown>> {
  return call(`/api/console/admin/${view}?workspace=${encodeURIComponent(id)}`, { ...options, token });
}

export function workspaceInstallations(token: string, id: string, options?: ConsoleCallOptions): Promise<Record<string, unknown>> {
  return adminView(token, "installations", id, options);
}

export function workspaceAudit(token: string, id: string, options?: ConsoleCallOptions): Promise<Record<string, unknown>> {
  return adminView(token, "audit", id, options);
}

export function workspaceUsage(token: string, id: string, options?: ConsoleCallOptions): Promise<Record<string, unknown>> {
  return adminView(token, "usage", id, options);
}

export function workspaceRouting(token: string, id: string, options?: ConsoleCallOptions): Promise<Record<string, unknown>> {
  return adminView(token, "routing", id, options);
}

export interface ConsoleMembership {
  workspace: string;
  displayName: string;
  plan: string;
  status: string;
  role: "admin" | "member";
}

function toMemberships(payload: unknown): ConsoleMembership[] {
  const rows = asRecord(payload).memberships;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown): ConsoleMembership[] => {
    const record = asRecord(row);
    if (typeof record.workspace !== "string" || !validWorkspaceId(record.workspace)) return [];
    if (record.role !== "admin" && record.role !== "member") return [];
    return [{
      workspace: record.workspace,
      displayName: typeof record.displayName === "string" ? record.displayName : record.workspace,
      plan: typeof record.plan === "string" ? record.plan : "free",
      status: typeof record.status === "string" ? record.status : "active",
      role: record.role,
    }];
  });
}

export function myMemberships(token: string, options?: ConsoleCallOptions): Promise<{ memberships: ConsoleMembership[] }> {
  return call<unknown>("/api/console/memberships", { ...options, token }).then((payload) => ({ memberships: toMemberships(payload) }));
}

const WORKSPACE_KEY = "maximus.console.workspace";

export function rememberedWorkspace(storage: Pick<AccountStorage, "getItem" | "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage): string {
  try {
    const value = storage?.getItem(WORKSPACE_KEY) ?? "";
    return validWorkspaceId(value) ? value.trim() : "";
  } catch {
    return "";
  }
}

export function rememberWorkspace(id: string, storage: Pick<AccountStorage, "getItem" | "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage): void {
  try {
    if (validWorkspaceId(id)) storage?.setItem(WORKSPACE_KEY, id.trim());
  } catch {
    /* private mode keeps the id for this visit only */
  }
}

export interface ConsolePlanView {
  id: string;
  name: string;
  blurb: string;
  baseUsd: number;
  allowanceUsd: number;
  hardCapUsd: number | null;
  entitlements: string[];
  features: string[];
}

export function consolePlans(options?: ConsoleCallOptions): Promise<{ plans: ConsolePlanView[] }> {
  return call("/api/console/plans", { ...options });
}

export function formatUsd(amount: number): string {
  return `$${amount}`;
}

export function planPriceLine(plan: ConsolePlanView): string {
  if (plan.baseUsd <= 0) return "Free";
  return `${formatUsd(plan.baseUsd)}/mo`;
}

export interface BillingOfferView {
  currency: "USD" | "NGN";
  provider: "stripe" | "paystack" | "bachs";
  paystackEnabled: boolean;
  bachsEnabled?: boolean;
  ngnPerUsd: number;
}

export function billingOffer(timeZone: string, options?: ConsoleCallOptions): Promise<{ offer: BillingOfferView }> {
  return call<{ offer: BillingOfferView }>(`/api/billing/offer?timeZone=${encodeURIComponent(timeZone)}`, options ?? {});
}

export function startPaystackCheckout(input: {
  plan: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  timeZone: string;
}, options?: ConsoleCallOptions): Promise<{ checkout: { url: string } }> {
  return call<{ checkout: { url: string } }>("/api/billing/checkout", {
    ...options,
    method: "POST",
    body: { provider: "paystack", ...input },
  });
}

export function startStripeCheckout(input: {
  plan: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  timeZone: string;
}, options?: ConsoleCallOptions): Promise<{ checkout: { url: string } }> {
  return call<{ checkout: { url: string } }>("/api/billing/checkout", {
    ...options,
    method: "POST",
    body: { provider: "stripe", ...input },
  });
}

export function startBachsCheckout(input: {
  plan: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  timeZone: string;
}, options?: ConsoleCallOptions): Promise<{ checkout: { url: string } }> {
  return call<{ checkout: { url: string } }>("/api/billing/checkout", {
    ...options,
    method: "POST",
    body: { provider: "bachs", ...input },
  });
}
