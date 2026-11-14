// Harness-leg admin client: the server owner's own APIs (users, sessions,
// pairing codes, provider keys, bots/threads, usage, activity) through the
// same-origin session cookie. No app store: the standalone /admin page uses
// this beside the console account token.
export class HarnessError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "HarnessError";
    this.status = status;
  }
}

export type HarnessFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface HarnessCallOptions {
  fetchImpl?: HarnessFetch;
  timeoutMs?: number;
}

async function call<T>(path: string, options: HarnessCallOptions & { method?: string; body?: unknown }): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (!res.ok) {
    const message = typeof payload.error === "string" ? payload.error : `Request failed (${res.status})`;
    throw new HarnessError(message, res.status);
  }
  return payload as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export interface HarnessSessionView {
  kind: "loopback" | "session" | "none";
  admin: boolean;
  email: string;
  label: string;
}

/** Who the cookie (or the machine, on owner-trust loopback) is. Unknown shapes are nobody, never an admin. */
export function toHarnessSession(payload: unknown): HarnessSessionView {
  const record = asRecord(payload);
  if (record.kind === "session" && typeof record.id === "string") {
    const scopes = asStringArray(record.scopes);
    return {
      kind: "session",
      admin: scopes.includes("admin"),
      email: typeof record.email === "string" ? record.email : "",
      label: typeof record.label === "string" ? record.label : "",
    };
  }
  if (record.kind === "loopback" && record.trust !== "service") {
    return { kind: "loopback", admin: true, email: "", label: "" };
  }
  return { kind: "none", admin: false, email: "", label: "" };
}

/** Server email sign-in, then back to the admin dashboard. `/` is the marketing page in a browser. */
export const HARNESS_SIGN_IN = "/pair?next=/admin";

export function harnessSession(options?: HarnessCallOptions): Promise<HarnessSessionView> {
  return call<unknown>("/api/auth/session", options ?? {}).then(toHarnessSession, () => toHarnessSession(null));
}

export interface SignInLists {
  admins: string[];
  members: string[];
}

export function toSignInLists(config: unknown): SignInLists {
  const signIn = asRecord(asRecord(config).signIn);
  return { admins: asStringArray(signIn.admins), members: asStringArray(signIn.members) };
}

export function harnessConfig(options?: HarnessCallOptions): Promise<Record<string, unknown>> {
  return call<Record<string, unknown>>("/api/config", options ?? {});
}

export function saveHarnessConfig(patch: Record<string, unknown>, options?: HarnessCallOptions): Promise<Record<string, unknown>> {
  return call<Record<string, unknown>>("/api/config", { ...options, method: "PUT", body: patch });
}

export interface DeliveryView {
  host: string;
  port: number;
  username: string;
  from: string;
  passwordSet: boolean;
  formatModel: string;
  ceilings: Record<string, number>;
  synced: boolean | null;
}

export function harnessDelivery(options?: HarnessCallOptions): Promise<DeliveryView> {
  return call<DeliveryView>("/api/admin/delivery", options ?? {});
}

export function saveHarnessDelivery(patch: Record<string, unknown>, options?: HarnessCallOptions): Promise<DeliveryView> {
  return call<DeliveryView>("/api/admin/delivery", { ...options, method: "PUT", body: patch });
}

export interface HarnessSessionRow {
  id: string;
  label: string;
  email: string;
  scopes: string[];
  expiresAt: number;
  current: boolean;
}

export function toHarnessSessions(payload: unknown): HarnessSessionRow[] {
  const record = asRecord(payload);
  const current = typeof record.current === "string" ? record.current : "";
  const rows = Array.isArray(record.sessions) ? record.sessions : [];
  return rows.flatMap((row: unknown): HarnessSessionRow[] => {
    const entry = asRecord(row);
    if (typeof entry.id !== "string" || !entry.id) return [];
    return [{
      id: entry.id,
      label: typeof entry.label === "string" ? entry.label : "",
      email: typeof entry.email === "string" ? entry.email : "",
      scopes: asStringArray(entry.scopes),
      expiresAt: typeof entry.expiresAt === "number" ? entry.expiresAt : 0,
      current: entry.id === current,
    }];
  });
}

export function harnessSessions(options?: HarnessCallOptions): Promise<{ sessions: HarnessSessionRow[] }> {
  return call<unknown>("/api/auth/sessions", options ?? {}).then((payload) => ({ sessions: toHarnessSessions(payload) }));
}

export function revokeHarnessSession(id: string, options?: HarnessCallOptions): Promise<{ ok: boolean }> {
  return call(`/api/auth/sessions/${encodeURIComponent(id)}`, { ...options, method: "DELETE" });
}

export interface HarnessPairing {
  code: string;
  label: string;
  expiresAt: number;
}

export function toHarnessPairings(payload: unknown): HarnessPairing[] {
  // POST /api/auth/pairing answers one pairing (with its single-show code);
  // GET answers { pairings } without codes, so an id stands in as the handle.
  const rows = Array.isArray(asRecord(payload).pairings) ? asRecord(payload).pairings as unknown[] : [payload];
  return rows.flatMap((row: unknown): HarnessPairing[] => {
    const entry = asRecord(row);
    const code = typeof entry.code === "string" && entry.code ? entry.code : typeof entry.id === "string" ? entry.id : "";
    if (!code) return [];
    return [{
      code,
      label: typeof entry.label === "string" ? entry.label : "",
      expiresAt: typeof entry.expiresAt === "number" ? entry.expiresAt : 0,
    }];
  });
}

export function harnessPairings(options?: HarnessCallOptions): Promise<{ pairings: HarnessPairing[] }> {
  return call<unknown>("/api/auth/pairing", options ?? {}).then((payload) => ({ pairings: toHarnessPairings(payload) }));
}

export function createHarnessPairing(input: { label?: string; ttlMs?: number }, options?: HarnessCallOptions): Promise<Record<string, unknown>> {
  return call<Record<string, unknown>>("/api/auth/pairing", { ...options, method: "POST", body: input });
}

export interface UsageGroupView {
  key: string;
  label: string;
  input: number;
  output: number;
  costUsd: number | null;
}

export function toUsageGroups(payload: unknown): { groups: UsageGroupView[]; total: UsageGroupView | null } {
  const group = (row: unknown): UsageGroupView | null => {
    const entry = asRecord(row);
    if (typeof entry.key !== "string") return null;
    const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
    return {
      key: entry.key,
      label: typeof entry.label === "string" ? entry.label : entry.key,
      input: number(entry.input),
      output: number(entry.output),
      costUsd: typeof entry.costUsd === "number" && Number.isFinite(entry.costUsd) ? entry.costUsd : null,
    };
  };
  const record = asRecord(payload);
  const groups = Array.isArray(record.groups) ? record.groups.flatMap((row: unknown) => { const view = group(row); return view ? [view] : []; }) : [];
  return { groups, total: group(record.total) };
}

export function harnessUsage(groupBy: string, options?: HarnessCallOptions): Promise<{ groups: UsageGroupView[]; total: UsageGroupView | null }> {
  return call<unknown>(`/api/usage?groupBy=${encodeURIComponent(groupBy)}`, options ?? {}).then(toUsageGroups);
}

export interface HarnessBotView {
  id: string;
  name: string;
  threadId: string;
  threads: { threadId: string; title: string }[];
}

export function toHarnessBots(payload: unknown): HarnessBotView[] {
  const rows = asRecord(payload).bots;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown): HarnessBotView[] => {
    const bot = asRecord(row);
    if (typeof bot.id !== "string" || !bot.id) return [];
    const main = typeof bot.threadId === "string" ? bot.threadId : "";
    const tasks = Array.isArray(bot.tasks) ? bot.tasks : [];
    const threads = tasks.flatMap((task: unknown): { threadId: string; title: string }[] => {
      const entry = asRecord(task);
      const threadId = typeof entry.threadId === "string" ? entry.threadId : typeof entry.id === "string" ? entry.id : "";
      if (!threadId) return [];
      return [{ threadId, title: typeof entry.title === "string" ? entry.title : threadId }];
    });
    if (main && !threads.some((thread) => thread.threadId === main)) threads.unshift({ threadId: main, title: main });
    return [{
      id: bot.id,
      name: typeof bot.name === "string" && bot.name ? bot.name : bot.id,
      threadId: main,
      threads,
    }];
  });
}

export function harnessBots(options?: HarnessCallOptions): Promise<{ bots: HarnessBotView[] }> {
  return call<unknown>("/api/bots?messages=0", options ?? {}).then((payload) => ({ bots: toHarnessBots(payload) }));
}

export interface HarnessMessageView {
  id: string;
  role: string;
  kind: string;
  text: string;
}

function messageText(row: Record<string, unknown>): string {
  if (typeof row.text === "string" && row.text) return row.text;
  const content = row.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content.flatMap((part) => {
      const record = asRecord(part);
      return typeof record.text === "string" ? [record.text] : [];
    });
    if (parts.length > 0) return parts.join("\n");
  }
  const tool = asRecord(row.tool);
  if (typeof tool.name === "string" && tool.name) return tool.name;
  return "";
}

export function toHarnessMessages(payload: unknown): HarnessMessageView[] {
  const rows = asRecord(payload).messages;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown, index: number): HarnessMessageView[] => {
    const entry = asRecord(row);
    const role = typeof entry.role === "string" ? entry.role : "unknown";
    const kind = typeof entry.kind === "string" ? entry.kind : "message";
    return [{
      id: typeof entry.id === "string" && entry.id ? entry.id : `m${index}`,
      role,
      kind,
      text: messageText(entry),
    }];
  });
}

export function harnessThreadMessages(threadId: string, limit: number, options?: HarnessCallOptions): Promise<{ messages: HarnessMessageView[] }> {
  return call<unknown>(`/api/threads/${encodeURIComponent(threadId)}/messages?limit=${limit}`, options ?? {})
    .then((payload) => ({ messages: toHarnessMessages(payload) }));
}

export function harnessSendMessage(botId: string, input: { text: string; threadId?: string }, options?: HarnessCallOptions): Promise<Record<string, unknown>> {
  return call<Record<string, unknown>>(`/api/bots/${encodeURIComponent(botId)}/messages`, { ...options, method: "POST", body: input });
}

export interface HarnessActivityView {
  id: string;
  category: string;
  action: string;
  summary: string;
  createdAt: number;
}

export function toHarnessActivity(payload: unknown): HarnessActivityView[] {
  const rows = Array.isArray(payload) ? payload : asRecord(payload).activity;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown, index: number): HarnessActivityView[] => {
    const entry = asRecord(row);
    const action = typeof entry.action === "string" ? entry.action : "";
    if (!action) return [];
    const target = asRecord(entry.target);
    const name = typeof target.name === "string" && target.name ? target.name : typeof target.id === "string" ? target.id : "";
    const actor = asRecord(entry.actor);
    const who = typeof actor.email === "string" && actor.email ? actor.email : typeof actor.label === "string" ? actor.label : "";
    return [{
      id: typeof entry.id === "string" && entry.id ? entry.id : `a${index}`,
      category: typeof entry.category === "string" ? entry.category : "",
      action,
      summary: [who, name].filter(Boolean).join(" · "),
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : 0,
    }];
  });
}

export function harnessActivity(options?: HarnessCallOptions): Promise<{ activity: HarnessActivityView[] }> {
  return call<unknown>("/api/admin-activity", options ?? {}).then((payload) => ({ activity: toHarnessActivity(payload) }));
}

export interface HarnessHealthView {
  ok: boolean;
  version: string;
}

export function toHarnessHealth(payload: unknown): HarnessHealthView {
  const record = asRecord(payload);
  return {
    ok: (typeof record.app === "string" && record.app !== "") || typeof record.pid === "number" || record.ok === true,
    version: typeof record.version === "string" ? record.version : "",
  };
}

export function harnessHealth(options?: HarnessCallOptions): Promise<HarnessHealthView> {
  return call<unknown>("/api/health", options ?? {}).then(toHarnessHealth);
}

export const KNOWN_ENTITLEMENTS: readonly string[] = ["whitelabel", "sso", "admin", "budgets", "billing", "gateway"];

export interface AdminPlan {
  id: string;
  name: string;
  blurb: string;
  features: string[];
  baseUsd: number;
  allowanceUsd: number;
  hardCapUsd: number | null;
  entitlements: string[];
  source: "stored" | "env" | "builtin";
  editable: boolean;
}

export function toAdminPlans(payload: unknown): AdminPlan[] {
  const rows = asRecord(payload).plans;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown): AdminPlan[] => {
    const record = asRecord(row);
    if (typeof record.id !== "string" || !record.id) return [];
    const money = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);
    const cap = record.hardCapUsd;
    return [{
      id: record.id,
      name: typeof record.name === "string" && record.name ? record.name : record.id,
      blurb: typeof record.blurb === "string" ? record.blurb : "",
      features: asStringArray(record.features),
      baseUsd: money(record.baseUsd),
      allowanceUsd: money(record.allowanceUsd),
      hardCapUsd: typeof cap === "number" && Number.isFinite(cap) && cap >= 0 ? cap : null,
      entitlements: asStringArray(record.entitlements),
      source: record.source === "stored" || record.source === "env" ? record.source : "builtin",
      editable: record.editable === true && record.id !== "free",
    }];
  });
}

export function adminPlans(options?: HarnessCallOptions): Promise<{ plans: AdminPlan[] }> {
  return call<unknown>("/api/admin/plans", options ?? {}).then((payload) => ({ plans: toAdminPlans(payload) }));
}

export interface AdminPlanInput {
  id: string;
  name: string;
  blurb: string;
  features: string[];
  baseUsd: number;
  allowanceUsd: number;
  hardCapUsd: number | null;
  entitlements: string[];
}

export function createPlan(input: AdminPlanInput, options?: HarnessCallOptions): Promise<Record<string, unknown>> {
  return call<Record<string, unknown>>("/api/admin/plans", { ...options, method: "POST", body: { ...input, display: { name: input.name, blurb: input.blurb, features: input.features } } });
}

export function updatePlan(id: string, input: AdminPlanInput, options?: HarnessCallOptions): Promise<Record<string, unknown>> {
  return call<Record<string, unknown>>(`/api/admin/plans/${encodeURIComponent(id)}`, { ...options, method: "PUT", body: { ...input, id, display: { name: input.name, blurb: input.blurb, features: input.features } } });
}

export interface RationRate {
  id: string;
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
}

export interface RationTier {
  id: "starter" | "plus" | "pro";
  priceUsd: number;
  storePriceUsd: number;
  includedCostUsd: number;
  hardCapUsd: number;
  models: string[];
}

export interface RationProfileView {
  version: 1;
  rates: RationRate[];
  freeGrantUsd: number;
  contributorFree: boolean;
  freeDailyRequests: number;
  freeOutputReserve: number;
  byoPriceUsd: number;
  byoStorePriceUsd: number;
  byoRequestsPerHour: number;
  byoRequestsPerDay: number;
  overageEnabled: boolean;
  overageMultiplier: number;
  overageCapMultiplier: number;
  hosted: RationTier[];
}

export interface RationAdminView {
  profile: RationProfileView;
  preview: { freeOutputTokens: number; starterOutputTokens: number; plusOutputTokens: number; proOutputTokens: number };
  pool: { configured: boolean; last4: string };
  source: "stored" | "builtin";
}

export function adminRation(options?: HarnessCallOptions): Promise<RationAdminView> {
  return call<RationAdminView>("/api/admin/ration", options ?? {});
}

export function saveRation(profile: RationProfileView, options?: HarnessCallOptions): Promise<RationAdminView> {
  return call<RationAdminView>("/api/admin/ration", { ...options, method: "PUT", body: profile });
}

export function saveRationPoolKey(key: string, options?: HarnessCallOptions): Promise<{ pool: { configured: boolean; last4: string } }> {
  return call<{ pool: { configured: boolean; last4: string } }>("/api/admin/ration/pool-key", { ...options, method: "PUT", body: { key } });
}

export interface GatewaySecretStatusView {
  configured: boolean;
  last4: string;
}

export interface PaymentSettingsView {
  paystackEnabled: boolean;
  bachsEnabled: boolean;
  ngnPerUsd: number;
  bachsApiBase?: string;
  secrets?: {
    paystackSecretKey: GatewaySecretStatusView;
    bachsApiKey: GatewaySecretStatusView;
    bachsWebhookSecret: GatewaySecretStatusView;
    stripeSecretKey: GatewaySecretStatusView;
  };
}

export type PaymentSettingsSave = {
  paystackEnabled: boolean;
  bachsEnabled: boolean;
  ngnPerUsd: number;
  paystackSecretKey?: string;
  bachsApiKey?: string;
  bachsWebhookSecret?: string;
  stripeSecretKey?: string;
  bachsApiBase?: string;
};

export function adminPayments(options?: HarnessCallOptions): Promise<{ payments: PaymentSettingsView }> {
  return call<{ payments: PaymentSettingsView }>("/api/admin/payments", options ?? {});
}

export function savePayments(payments: PaymentSettingsSave, options?: HarnessCallOptions): Promise<{ payments: PaymentSettingsView }> {
  return call<{ payments: PaymentSettingsView }>("/api/admin/payments", { ...options, method: "PUT", body: payments });
}

export interface HarnessEditionView {
  edition: string;
  detail: string;
}

export function toHarnessEdition(payload: unknown): HarnessEditionView {
  const record = asRecord(payload);
  return {
    edition: typeof record.edition === "string" ? record.edition : "unknown",
    detail: typeof record.detail === "string" ? record.detail : "",
  };
}

export function harnessEdition(options?: HarnessCallOptions): Promise<HarnessEditionView> {
  return call<unknown>("/api/edition", options ?? {}).then(toHarnessEdition);
}
