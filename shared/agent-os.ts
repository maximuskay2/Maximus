/** Wire types for Agent OS: named machines, routing, policy, audit, and app plug-ins. */

export const AGENT_OS_MACHINE_KINDS = ["this_desktop", "cloud_home", "lent_peer", "team_boat"] as const;
export type AgentOsMachineKind = (typeof AGENT_OS_MACHINE_KINDS)[number];

export const AGENT_OS_CAPABILITIES = ["computer", "browser", "connector"] as const;
export type AgentOsCapability = (typeof AGENT_OS_CAPABILITIES)[number];

export const AGENT_OS_PLUGIN_MODES = ["api", "browser", "local"] as const;
export type AgentOsPluginMode = (typeof AGENT_OS_PLUGIN_MODES)[number];

export interface AgentOsMachine {
  id: string;
  name: string;
  kind: AgentOsMachineKind;
  online: boolean;
  capabilities: AgentOsCapability[];
  lastSeenAt: number;
}

export interface AgentOsMachinesPayload {
  machines: AgentOsMachine[];
  multiMachine: boolean;
  selfId: string;
}

export interface AgentOsAssignment {
  machineId: string;
  threadId?: string;
  botId?: string;
}

export interface AgentOsAuditRow {
  at: number;
  actor: string;
  botId?: string;
  machineId?: string;
  tool: string;
  approved: boolean;
  outcome: "ok" | "denied" | "offline" | "error";
  detail?: string;
}

export interface AgentOsPolicy {
  /** Bot ids allowed to use a machine; empty means any bot the person may run. */
  bots: string[];
  /** Machine ids; empty means the OSS set (this desktop and optional cloud home). */
  machines: string[];
  capabilities: AgentOsCapability[];
}

export interface AgentOsPlugin {
  mode: AgentOsPluginMode;
  app: string;
  actions: string[];
}

export const AGENT_OS_WRITE_ACTIONS = ["post", "update", "publish", "push", "comment"] as const;
export type AgentOsWriteAction = (typeof AGENT_OS_WRITE_ACTIONS)[number];

export function isAgentOsWriteAction(action: string): boolean {
  return (AGENT_OS_WRITE_ACTIONS as readonly string[]).includes(action);
}

export const AGENT_OS_STALE_MS = 90_000;
export const AGENT_OS_ENTITLEMENT = "agentOsMachines";
