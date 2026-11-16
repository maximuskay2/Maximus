import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import {
  AGENT_OS_CAPABILITIES,
  AGENT_OS_ENTITLEMENT,
  AGENT_OS_MACHINE_KINDS,
  AGENT_OS_PLUGIN_MODES,
  AGENT_OS_STALE_MS,
  isAgentOsWriteAction,
  type AgentOsAssignment,
  type AgentOsAuditRow,
  type AgentOsCapability,
  type AgentOsMachine,
  type AgentOsMachineKind,
  type AgentOsMachinesPayload,
  type AgentOsPlugin,
  type AgentOsPluginMode,
  type AgentOsPolicy,
} from "../shared/agent-os.ts";
import type { PersonConnectorAccount } from "./agent-os-connectors.ts";
import { executeAgentOsPlugin, type AgentOsClient, type ExecutePluginInput } from "./agent-os-plugins.ts";
import { noteAgentOsThread } from "./agent-os-thread-note.ts";
import { writeFileAtomic } from "./atomic.ts";
import { entitled } from "./enterprise.ts";

const MACHINES_FILE = "agent-os-machines.json";
const ASSIGN_FILE = "agent-os-assignments.json";
const POLICY_FILE = "agent-os-policy.json";
const AUDIT_FILE = "agent-os-audit.jsonl";
const SELF_ID = "self";

const machineSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(AGENT_OS_MACHINE_KINDS),
  lastSeenAt: z.number().int().nonnegative(),
  capabilities: z.array(z.enum(AGENT_OS_CAPABILITIES)).max(8),
});
const machinesFileSchema = z.object({
  v: z.literal(1),
  machines: z.array(machineSchema).max(40),
});
const assignmentSchema = z.object({
  machineId: z.string().min(1).max(80),
  threadId: z.string().min(1).max(80).optional(),
  botId: z.string().min(1).max(80).optional(),
});
const assignmentsFileSchema = z.object({
  v: z.literal(1),
  assignments: z.array(assignmentSchema).max(200),
});
const policySchema = z.object({
  bots: z.array(z.string().min(1).max(80)).max(200),
  machines: z.array(z.string().min(1).max(80)).max(40),
  capabilities: z.array(z.enum(AGENT_OS_CAPABILITIES)).max(8),
});

const DEFAULT_POLICY: AgentOsPolicy = { bots: [], machines: [], capabilities: [...AGENT_OS_CAPABILITIES] };

const PLUGINS: AgentOsPlugin[] = [
  { mode: "api", app: "figma", actions: ["list", "lookup", "comment"] },
  { mode: "browser", app: "canva", actions: ["list", "lookup", "publish"] },
  { mode: "local", app: "git", actions: ["lookup", "post", "push"] },
  { mode: "local", app: "erp", actions: ["lookup", "post", "update"] },
];

export interface AgentOsOptions {
  dataDir: string;
  now?: () => number;
  entitled?: () => boolean;
  self?: { name: string; kind: AgentOsMachineKind; capabilities?: AgentOsCapability[] };
  listPersonConnector?: (slug: string) => Promise<PersonConnectorAccount>;
  executePersonConnector?: ExecutePluginInput["executePersonConnector"];
  attachNamedBrowser?: ExecutePluginInput["attachNamedBrowser"];
  clickPublish?: ExecutePluginInput["clickPublish"];
}

function readJson<T>(path: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

function ossMachine(kind: AgentOsMachineKind): boolean {
  return kind === "this_desktop" || kind === "cloud_home";
}

function lentOverlayIds(dataDir: string): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, "lent-computers.json"), "utf8")) as { computers?: Array<{ id?: string }> };
    return new Set((parsed.computers ?? []).map((row) => row.id).filter((id): id is string => Boolean(id)));
  } catch {
    return new Set();
  }
}

export interface AgentOsHost {
  selfId: string;
  heartbeat: (row: { id: string; name: string; kind: AgentOsMachineKind; capabilities?: AgentOsCapability[] }) => AgentOsMachine;
  payload: () => AgentOsMachinesPayload;
  find: (id: string) => AgentOsMachine | undefined;
  assign: (row: AgentOsAssignment) => AgentOsAssignment | { error: string };
  assignmentFor: (query: { threadId?: string; botId?: string }) => AgentOsAssignment | null;
  policy: () => AgentOsPolicy;
  writePolicy: (policy: AgentOsPolicy) => AgentOsPolicy;
  allow: (input: { botId?: string; machineId: string; capability: AgentOsCapability }) => { ok: true } | { ok: false; error: string };
  route: (input: { machineId: string; botId?: string; capability: AgentOsCapability; actor: string }) =>
    { ok: true; target: "local" | "remote"; machine: AgentOsMachine } | { ok: false; error: string; outcome: AgentOsAuditRow["outcome"]; machine?: AgentOsMachine };
  audit: (limit?: number) => AgentOsAuditRow[];
  plugins: () => AgentOsPlugin[];
  invoke: (input: {
    actor: string;
    mode: AgentOsPluginMode;
    app: string;
    action: string;
    personId: string;
    machineId?: string;
    confirm?: boolean;
    botId?: string;
    threadId?: string;
    client?: AgentOsClient;
    args?: Record<string, string>;
  }) => Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string; status: number; wait?: { machineId: string; name: string } }>;
}

export function createAgentOs(options: AgentOsOptions): AgentOsHost {
  mkdirSync(options.dataDir, { recursive: true });
  const existing = hosts.get(options.dataDir);
  if (existing) return existing;
  const now = options.now ?? Date.now;
  const machinesPath = join(options.dataDir, MACHINES_FILE);
  const assignPath = join(options.dataDir, ASSIGN_FILE);
  const policyPath = join(options.dataDir, POLICY_FILE);
  const auditPath = join(options.dataDir, AUDIT_FILE);
  const multi = () => (options.entitled ?? (() => entitled(AGENT_OS_ENTITLEMENT)))();
    const selfKind = options.self?.kind ?? (process.env.MAXIMUS_CLOUD_ROLE === "home" ? "cloud_home" : "this_desktop");
    const selfName = options.self?.name ?? (hostname() || "This computer");
  const selfCaps = options.self?.capabilities ?? ["computer", "browser", "connector"];

  const loadMachines = () => readJson(machinesPath, machinesFileSchema, { v: 1 as const, machines: [] as z.infer<typeof machineSchema>[] });
  const saveMachines = (machines: z.infer<typeof machineSchema>[]) => {
    writeFileAtomic(machinesPath, JSON.stringify({ v: 1, machines }), { mode: 0o600 });
  };

  const heartbeat = (row: { id: string; name: string; kind: AgentOsMachineKind; capabilities?: AgentOsCapability[] }): AgentOsMachine => {
    const file = loadMachines();
    const capabilities = row.capabilities?.length ? row.capabilities : [...selfCaps];
    const next = { id: row.id, name: row.name, kind: row.kind, lastSeenAt: now(), capabilities };
    const others = file.machines.filter((machine) => machine.id !== row.id);
    saveMachines([...others, next]);
    return { ...next, online: true };
  };

  heartbeat({ id: SELF_ID, name: selfName, kind: selfKind, capabilities: selfCaps });

  const overlay = (): AgentOsMachine[] => overlayKnownMachines(options.dataDir, now());

  const listed = (): AgentOsMachine[] => {
    const allowAll = multi();
    const byId = new Map<string, z.infer<typeof machineSchema>>();
    for (const machine of overlay()) byId.set(machine.id, machine);
    for (const machine of loadMachines().machines) byId.set(machine.id, machine);
    return [...byId.values()]
      .filter((machine) => allowAll || ossMachine(machine.kind) || machine.id === SELF_ID)
      .map((machine) => ({
        ...machine,
        online: machine.kind === "team_boat"
          ? machine.lastSeenAt > 0 && now() - machine.lastSeenAt <= AGENT_OS_STALE_MS
          : now() - machine.lastSeenAt <= AGENT_OS_STALE_MS,
      }));
  };

  const payload = (): AgentOsMachinesPayload => ({ machines: listed(), multiMachine: multi(), selfId: SELF_ID });

  const find = (id: string): AgentOsMachine | undefined => listed().find((machine) => machine.id === id);

  const loadAssignments = () => readJson(assignPath, assignmentsFileSchema, { v: 1 as const, assignments: [] as AgentOsAssignment[] });

  const assign = (row: AgentOsAssignment): AgentOsAssignment | { error: string } => {
    const machine = find(row.machineId);
    if (!machine) return { error: "Unknown machine" };
    const file = loadAssignments();
    const rest = file.assignments.filter((item) => {
      if (row.threadId) return item.threadId !== row.threadId;
      if (row.botId) return item.botId !== row.botId;
      return true;
    });
    const next = { machineId: row.machineId, ...(row.threadId ? { threadId: row.threadId } : {}), ...(row.botId ? { botId: row.botId } : {}) };
    writeFileAtomic(assignPath, JSON.stringify({ v: 1, assignments: [...rest, next] }), { mode: 0o600 });
    return next;
  };

  const assignmentFor = (query: { threadId?: string; botId?: string }): AgentOsAssignment | null => {
    const file = loadAssignments();
    if (query.threadId) {
      const hit = file.assignments.find((item) => item.threadId === query.threadId);
      if (hit) return hit;
    }
    if (query.botId) {
      const hit = file.assignments.find((item) => item.botId === query.botId);
      if (hit) return hit;
    }
    return null;
  };

  const loadPolicy = (): AgentOsPolicy => readJson(policyPath, policySchema, DEFAULT_POLICY);

  const writePolicy = (policy: AgentOsPolicy): AgentOsPolicy => {
    writeFileAtomic(policyPath, JSON.stringify(policy), { mode: 0o600 });
    return policy;
  };

  const allow = (input: { botId?: string; machineId: string; capability: AgentOsCapability }): { ok: true } | { ok: false; error: string } => {
    const policy = loadPolicy();
    if (policy.capabilities.length > 0 && !policy.capabilities.includes(input.capability)) {
      return { ok: false, error: "This capability is not allowed on Agent OS." };
    }
    if (policy.machines.length > 0 && !policy.machines.includes(input.machineId)) {
      return { ok: false, error: "This machine is not allowed for this workspace." };
    }
    if (input.botId && policy.bots.length > 0 && !policy.bots.includes(input.botId)) {
      return { ok: false, error: "This bot may not use Agent OS machines." };
    }
    const machine = find(input.machineId);
    if (!machine) return { ok: false, error: "Unknown machine" };
    if (!machine.capabilities.includes(input.capability)) {
      return { ok: false, error: "That machine does not offer this capability." };
    }
    return { ok: true };
  };

  const audit = (row: Omit<AgentOsAuditRow, "at">): AgentOsAuditRow => {
    const recorded = { at: now(), ...row };
    appendFileSync(auditPath, `${JSON.stringify(recorded)}\n`, { mode: 0o600 });
    return recorded;
  };

  const readAudit = (limit = 50): AgentOsAuditRow[] => {
    try {
      const lines = readFileSync(auditPath, "utf8").trim().split("\n").filter(Boolean);
      return lines.slice(-limit).map((line) => JSON.parse(line) as AgentOsAuditRow);
    } catch {
      return [];
    }
  };

  const route = (input: { machineId: string; botId?: string; capability: AgentOsCapability; actor: string }):
    { ok: true; target: "local" | "remote"; machine: AgentOsMachine } | { ok: false; error: string; outcome: AgentOsAuditRow["outcome"]; machine?: AgentOsMachine } => {
    const gate = allow({ botId: input.botId, machineId: input.machineId, capability: input.capability });
    if (!gate.ok) {
      audit({ actor: input.actor, botId: input.botId, machineId: input.machineId, tool: `route:${input.capability}`, approved: false, outcome: "denied", detail: gate.error });
      return { ok: false, error: gate.error, outcome: "denied" };
    }
    const machine = find(input.machineId);
    if (!machine) return { ok: false, error: "Unknown machine", outcome: "error" };
    if (!machine.online) {
      audit({ actor: input.actor, botId: input.botId, machineId: input.machineId, tool: `route:${input.capability}`, approved: false, outcome: "offline" });
      return { ok: false, error: `${machine.name} is asleep. Wake that computer, then try again.`, outcome: "offline", machine };
    }
    const target: "local" | "remote" = machine.id === SELF_ID ? "local" : "remote";
    if (target === "remote") {
      if (machine.kind !== "lent_peer" || !lentOverlayIds(options.dataDir).has(machine.id)) {
        const error = "That computer is not a live shared desktop. Lend it from Maximus on that Mac, then try again.";
        audit({ actor: input.actor, botId: input.botId, machineId: input.machineId, tool: `route:${input.capability}`, approved: false, outcome: "denied", detail: error });
        return { ok: false, error, outcome: "denied", machine };
      }
      if (!multi()) {
        const error = "Subscribe to Your model to use Agent OS. The monthly fee is this computer; your provider bills the tokens.";
        audit({ actor: input.actor, botId: input.botId, machineId: input.machineId, tool: `route:${input.capability}`, approved: false, outcome: "denied", detail: error });
        return { ok: false, error, outcome: "denied" };
      }
    }
    audit({ actor: input.actor, botId: input.botId, machineId: input.machineId, tool: `route:${input.capability}`, approved: true, outcome: "ok" });
    return { ok: true, target, machine };
  };

  const plugins = (): AgentOsPlugin[] => PLUGINS;

  const invoke = async (input: {
    actor: string;
    mode: AgentOsPluginMode;
    app: string;
    action: string;
    personId: string;
    machineId?: string;
    confirm?: boolean;
    botId?: string;
    threadId?: string;
    client?: AgentOsClient;
    args?: Record<string, string>;
  }): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string; status: number; wait?: { machineId: string; name: string } }> => {
    if (!(AGENT_OS_PLUGIN_MODES as readonly string[]).includes(input.mode)) {
      return { ok: false, error: "Unknown plug-in mode", status: 400 };
    }
    const plugin = PLUGINS.find((row) => row.mode === input.mode && row.app === input.app);
    if (!plugin || !plugin.actions.includes(input.action)) {
      return { ok: false, error: "Unknown app or action", status: 404 };
    }
    const write = isAgentOsWriteAction(input.action);
    if (write && !input.confirm) {
      audit({ actor: input.actor, botId: input.botId, machineId: input.machineId, tool: `${input.mode}:${input.app}:${input.action}`, approved: false, outcome: "denied", detail: "confirm required" });
      return { ok: false, error: "Confirm this write before Maximus sends it as you.", status: 409 };
    }
    const assigned = assignmentFor({ threadId: input.threadId, botId: input.botId });
    const machineId = input.machineId ?? assigned?.machineId ?? SELF_ID;
    const capability = input.mode === "browser" ? "browser" : input.mode === "local" ? "computer" : "connector";
    const routed = route({ machineId, botId: input.botId, capability, actor: input.actor });
    if (!routed.ok) {
      noteAgentOsThread(options.dataDir, input.threadId, routed.error, false);
      return {
        ok: false,
        error: routed.error,
        status: routed.outcome === "offline" ? 503 : 403,
        ...(routed.machine ? { wait: { machineId: routed.machine.id, name: routed.machine.name } } : {}),
      };
    }
    const executed = await executeAgentOsPlugin({
      mode: input.mode,
      app: input.app,
      action: input.action,
      personId: input.personId,
      dataDir: options.dataDir,
      confirmed: Boolean(input.confirm),
      target: routed.target,
      machine: routed.machine,
      client: input.client ?? "desktop",
      args: input.args,
      listPersonConnector: options.listPersonConnector,
      executePersonConnector: options.executePersonConnector,
      attachNamedBrowser: options.attachNamedBrowser,
      clickPublish: options.clickPublish,
    });
    const account = executed.account ?? input.personId;
    const detail = executed.detail ?? `person ${input.personId} account ${account} machine ${machineId}`;
    audit({
      actor: input.actor,
      botId: input.botId,
      machineId,
      tool: `${input.mode}:${input.app}:${input.action}`,
      approved: true,
      outcome: executed.ok ? "ok" : "error",
      detail: `person ${input.personId} account ${account} machine ${machineId}${executed.ok ? "" : ` — ${detail}`}`,
    });
    const result = {
      mode: input.mode,
      app: input.app,
      action: input.action,
      as: input.personId,
      account,
      machineId,
      bound: true,
      executed: executed.ok,
      preview: executed.preview ?? (write ? `${input.action} ${input.app} as ${input.personId}` : `${input.app} ${input.action}`),
      ...(executed.detail ? { detail: executed.detail } : {}),
      ...(executed.items ? { items: executed.items } : {}),
      ...(executed.cdpUrl ? { cdpUrl: executed.cdpUrl } : {}),
    };
    noteAgentOsThread(options.dataDir, input.threadId, String(executed.detail ?? result.preview), executed.ok);
    if (!executed.ok && write) {
      return { ok: false, error: String(executed.detail ?? result.preview), status: 409 };
    }
    return { ok: true, result };
  };

  const created = {
    selfId: SELF_ID,
    heartbeat,
    payload,
    find,
    assign,
    assignmentFor,
    policy: loadPolicy,
    writePolicy,
    allow,
    route,
    audit: readAudit,
    plugins,
    invoke,
  };
  hosts.set(options.dataDir, created);
  return created;
}

const hosts = new Map<string, AgentOsHost>();
const pulses = new Map<string, ReturnType<typeof setInterval>>();

export function agentOsForDir(dataDir: string): AgentOsHost {
  const existing = hosts.get(dataDir);
  if (existing) return existing;
  const created = createAgentOs({ dataDir });
  const pulse = setInterval(() => {
    created.heartbeat({
      id: created.selfId,
      name: hostname() || "This computer",
      kind: process.env.MAXIMUS_CLOUD_ROLE === "home" ? "cloud_home" : "this_desktop",
      capabilities: ["computer", "browser", "connector"],
    });
  }, Math.floor(AGENT_OS_STALE_MS / 3));
  pulse.unref();
  pulses.set(dataDir, pulse);
  return created;
}

export function resetAgentOsHosts(): void {
  for (const pulse of pulses.values()) clearInterval(pulse);
  pulses.clear();
  hosts.clear();
}

function overlayKnownMachines(dataDir: string, at: number): AgentOsMachine[] {
  const extra: AgentOsMachine[] = [];
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, "lent-computers.json"), "utf8")) as { computers?: Array<{ id: string; name: string; lastSeenAt: number; stoppedAt: number | null; screen?: boolean; chrome?: boolean; terminal?: boolean }> };
    for (const computer of parsed.computers ?? []) {
      if (!computer.id || !computer.name) continue;
      extra.push({
        id: computer.id,
        name: computer.name,
        kind: "lent_peer",
        lastSeenAt: computer.stoppedAt ? 0 : computer.lastSeenAt,
        capabilities: [
          ...(computer.screen || computer.terminal ? ["computer" as const] : []),
          ...(computer.chrome ? ["browser" as const] : []),
        ],
        online: computer.stoppedAt == null && at - computer.lastSeenAt <= AGENT_OS_STALE_MS,
      });
    }
  } catch {}
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, "team-computers.json"), "utf8")) as { computers?: Array<{ id: string; name: string; createdAt: number }> };
    for (const computer of parsed.computers ?? []) {
      if (!computer.id || !computer.name) continue;
      extra.push({
        id: computer.id,
        name: computer.name,
        kind: "team_boat",
        lastSeenAt: Math.max(0, at - AGENT_OS_STALE_MS - 1),
        capabilities: ["computer"],
        online: false,
      });
    }
  } catch {}
  return extra;
}

