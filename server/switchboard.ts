// Provider switchboard: three levels, evaluated top-down (first "off" wins, with
// a reason). Off providers hide from the picker with that reason; unknown
// provider ids grant nothing. Default state (no operator or workspace policy
// configured) leaves every provider on exactly as today.
//
// Levels (contracts section 4):
//  1. operator  — global kill-switch per provider id (MAXIMUS_OPERATOR_PROVIDERS).
//  2. workspace — admin per-provider mode byo|bundled|off + assigned-model
//     catalog (MAXIMUS_WORKSPACE_PROVIDERS; Track 3 persists the record).
//  3. bot       — per-bot model choice; enforced at selection time.
//
// Day-one provider pins (verified against official docs at build time):
//  Kimi (kimi): Kimi Model API, OpenAI- and Anthropic-compatible.
//    Chat Completions: POST https://api.moonshot.ai/v1/chat/completions
//      https://platform.kimi.ai/docs/api/chat.md
//    Responses: POST https://api.moonshot.ai/v1/responses
//      https://platform.kimi.ai/docs/api/responses.md
//    Messages (Anthropic-compatible): base https://api.moonshot.ai/anthropic,
//      POST /anthropic/v1/messages
//      https://platform.kimi.ai/docs/api/messages.md
//    Models (https://platform.kimi.ai/docs/models.md): kimi-k3.1-pro
//      (default flagship, 1M context), kimi-k3.1-pro-highspeed (same
//      intelligence, ~2-3x speed), kimi-k3 (previous flagship, 1M context).
//    Auth: MOONSHOT_API_KEY bearer. BYO instances ride the kimiAgent CLI
//    subscription login; bundled rides the kimiApi driver through the gateway.
//  Muse (muse): Muse Code CLI as a spawned agent and/or the Meta Model API.
//    CLI: `muse login` once, driven over `muse serve` (MSP); driver museCode.
//      https://dev.meta.ai/docs/muse-code
//    API: base https://api.meta.ai/v1; Chat Completions, Responses
//      (POST /v1/responses) and Messages protocols; GET /v1/models.
//      https://dev.meta.ai/docs/protocols
//      https://dev.meta.ai/docs/protocols/chat-completions
//      https://dev.meta.ai/docs/protocols/responses
//      https://dev.meta.ai/docs/protocols/messages
//    Models (https://dev.meta.ai/docs/models): muse-wonder-1.0 (default),
//      muse-spark-1.3, muse-spark-1.3-contributor (API driver); the CLI
//      driver falls back to muse-spark-1.2 until the account's live list
//      answers. Auth: META_API_KEY. Bundled tier (Spark vs Wonder) is an
//      owner decision.
export const PROVIDER_IDS = ["claude", "codex", "grok", "kimi", "muse"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: "Claude",
  codex: "Codex",
  grok: "Grok",
  kimi: "Kimi",
  muse: "Muse",
};

/** Default instance ids governed under each provider id. Instances not listed here are unaffected by the switchboard. */
export const PROVIDER_INSTANCES: Record<ProviderId, readonly string[]> = {
  claude: ["claude"],
  codex: ["codex", "chatgpt"],
  grok: ["grok"],
  kimi: ["kimi", "kimiApi"],
  muse: ["meta", "museCode"],
};

const INSTANCE_PROVIDER = new Map<string, ProviderId>();
for (const id of PROVIDER_IDS) for (const instanceId of PROVIDER_INSTANCES[id]) INSTANCE_PROVIDER.set(instanceId, id);

export function isKnownProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/** Null for instances the switchboard does not govern (they keep today's behavior). */
export function instanceProvider(instanceId: string): ProviderId | null {
  return INSTANCE_PROVIDER.get(instanceId) ?? null;
}

export interface OperatorEntry {
  enabled: boolean;
  reason?: string;
}
export interface OperatorPolicy {
  providers: Partial<Record<ProviderId, OperatorEntry>>;
  /** Set when the whole configuration was unreadable: every provider is off with this reason. */
  invalid?: string;
  /** Per-provider entries that failed validation: that provider is off with its reason. */
  entryInvalid?: Partial<Record<ProviderId, string>>;
}

export type WorkspaceMode = "byo" | "bundled" | "off";
export interface WorkspaceEntry {
  mode: WorkspaceMode;
  models: string[];
}
export interface WorkspacePolicy {
  providers: Partial<Record<ProviderId, WorkspaceEntry>>;
  invalid?: string;
  entryInvalid?: Partial<Record<ProviderId, string>>;
}

const OPERATOR_ENV = "MAXIMUS_OPERATOR_PROVIDERS";
const WORKSPACE_ENV = "MAXIMUS_WORKSPACE_PROVIDERS";
const MAX_MODELS = 100;

function cleanModels(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_MODELS) return null;
  const models: string[] = [];
  const seen = new Set<string>();
  for (const model of value) {
    if (typeof model !== "string" || !model || model.length > 160 || model.trim() !== model) return null;
    if (seen.has(model)) continue;
    seen.add(model);
    models.push(model);
  }
  return models;
}

export function parseOperatorPolicy(raw: unknown): OperatorPolicy {
  if (raw === undefined || raw === null) return { providers: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      providers: {},
      invalid: `Provider switches are misconfigured (${OPERATOR_ENV} must be a JSON object); fix the configuration to restore providers.`,
    };
  }
  const policy: OperatorPolicy = { providers: {}, entryInvalid: {} };
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!isKnownProviderId(id)) continue;
    const label = PROVIDER_LABELS[id];
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof (entry as { enabled?: unknown }).enabled !== "boolean") {
      policy.entryInvalid![id] = `${label} is unavailable (invalid operator configuration for "${id}").`;
      continue;
    }
    const { enabled, reason } = entry as { enabled: boolean; reason?: unknown };
    if (reason !== undefined && (typeof reason !== "string" || !reason.trim() || reason.length > 300)) {
      policy.entryInvalid![id] = `${label} is unavailable (invalid operator configuration for "${id}").`;
      continue;
    }
    policy.providers[id] = reason === undefined ? { enabled } : { enabled, reason };
  }
  if (!Object.keys(policy.entryInvalid!).length) delete policy.entryInvalid;
  return policy;
}

export function parseWorkspacePolicy(raw: unknown): WorkspacePolicy {
  if (raw === undefined || raw === null) return { providers: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      providers: {},
      invalid: `Workspace provider switches are misconfigured (${WORKSPACE_ENV} must be a JSON object); fix the configuration to restore providers.`,
    };
  }
  const policy: WorkspacePolicy = { providers: {}, entryInvalid: {} };
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!isKnownProviderId(id)) continue;
    const label = PROVIDER_LABELS[id];
    const record = (entry ?? {}) as { mode?: unknown; models?: unknown };
    if (record.mode !== "byo" && record.mode !== "bundled" && record.mode !== "off") {
      policy.entryInvalid![id] = `${label} is unavailable (invalid workspace configuration for "${id}").`;
      continue;
    }
    if (record.mode === "bundled") {
      const models = cleanModels(record.models);
      if (models === null) {
        policy.entryInvalid![id] = `${label} is unavailable (invalid workspace configuration for "${id}").`;
        continue;
      }
      policy.providers[id] = { mode: record.mode, models };
    } else {
      policy.providers[id] = { mode: record.mode, models: [] };
    }
  }
  if (!Object.keys(policy.entryInvalid!).length) delete policy.entryInvalid;
  return policy;
}

const policyCache = new Map<string, { raw: string | undefined; operator: OperatorPolicy; workspace: WorkspacePolicy }>();

function policiesFromEnv(env: NodeJS.ProcessEnv): { operator: OperatorPolicy; workspace: WorkspacePolicy } {
  const key = `${env[OPERATOR_ENV] ?? ""}\n${env[WORKSPACE_ENV] ?? ""}`;
  const cached = policyCache.get(key);
  if (cached) return cached;
  // An unparseable value is not an empty policy: fail closed with a reason.
  const decode = (text: string | undefined): unknown => {
    if (text === undefined || !text.trim()) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return 42;
    }
  };
  const decoded = {
    operator: parseOperatorPolicy(decode(env[OPERATOR_ENV])),
    workspace: parseWorkspacePolicy(decode(env[WORKSPACE_ENV])),
  };
  if (policyCache.size > 16) policyCache.clear();
  policyCache.set(key, { raw: key, operator: decoded.operator, workspace: decoded.workspace });
  return decoded;
}

export function resetSwitchboardCacheForTests(): void {
  policyCache.clear();
}

export interface ProviderVerdict {
  allowed: boolean;
  reason?: string;
  level?: "operator" | "workspace";
  mode?: WorkspaceMode;
  models?: string[];
}

export interface SwitchboardPolicies {
  operator?: OperatorPolicy;
  workspace?: WorkspacePolicy;
}

function policiesOrEnv(policies: SwitchboardPolicies | undefined, env: NodeJS.ProcessEnv): { operator: OperatorPolicy; workspace: WorkspacePolicy } {
  if (policies?.operator && policies?.workspace) return { operator: policies.operator, workspace: policies.workspace };
  const fromEnv = policiesFromEnv(env);
  return { operator: policies?.operator ?? fromEnv.operator, workspace: policies?.workspace ?? fromEnv.workspace };
}

/** First "off" wins, with its reason. Unknown ids are never allowed. */
export function resolveProvider(
  providerId: string,
  policies?: SwitchboardPolicies,
  env: NodeJS.ProcessEnv = process.env,
): ProviderVerdict {
  if (!isKnownProviderId(providerId)) return { allowed: false, reason: `Unknown provider "${providerId}".` };
  const { operator, workspace } = policiesOrEnv(policies, env);
  const label = PROVIDER_LABELS[providerId];
  if (operator.invalid) return { allowed: false, reason: operator.invalid, level: "operator" };
  if (operator.entryInvalid?.[providerId]) return { allowed: false, reason: operator.entryInvalid[providerId], level: "operator" };
  const kill = operator.providers[providerId];
  if (kill && !kill.enabled) {
    return { allowed: false, reason: kill.reason ?? `${label} is turned off by the operator.`, level: "operator" };
  }
  if (workspace.invalid) return { allowed: false, reason: workspace.invalid, level: "workspace" };
  if (workspace.entryInvalid?.[providerId]) {
    return { allowed: false, reason: workspace.entryInvalid[providerId], level: "workspace" };
  }
  const entry = workspace.providers[providerId];
  if (!entry || entry.mode === "byo") return { allowed: true, mode: "byo" };
  if (entry.mode === "off") return { allowed: false, reason: `${label} is turned off for this workspace.`, level: "workspace" };
  if (!entry.models.length) {
    return {
      allowed: false,
      level: "workspace",
      reason: `No ${label} models are assigned to this workspace. Ask your administrator to enable model access in Admin.`,
    };
  }
  return { allowed: true, mode: "bundled", models: [...entry.models] };
}

/** Instance-level refusal for the picker and policy gates; undefined means selectable. */
export function switchboardInstanceRefusal(
  instanceId: string,
  policies?: SwitchboardPolicies,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const providerId = instanceProvider(instanceId);
  if (!providerId) return undefined;
  const verdict = resolveProvider(providerId, policies, env);
  return verdict.allowed ? undefined : verdict.reason;
}

/** Selection-time refusal: instance policy plus bundled assigned-model enforcement. */
export function switchboardSelectionRefusal(
  selection: { instanceId: string; model: string },
  policies?: SwitchboardPolicies,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const providerId = instanceProvider(selection.instanceId);
  if (!providerId) return undefined;
  const verdict = resolveProvider(providerId, policies, env);
  if (!verdict.allowed) return verdict.reason;
  if (verdict.mode === "bundled" && verdict.models && !verdict.models.includes(selection.model)) {
    return `This model is not assigned to this workspace. Choose one of its ${PROVIDER_LABELS[providerId]} models.`;
  }
  return undefined;
}
