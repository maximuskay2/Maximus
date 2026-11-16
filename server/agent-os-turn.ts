import type { HarnessClient, Json } from "./drivers/agents-client.ts";
import { AGENT_OS_PLUGIN_MODES } from "../shared/agent-os.ts";
import { agentOsForDir } from "./agent-os.ts";

export interface AgentOsTurnContext {
  botId: string;
  threadId: string;
  sharedComputers: boolean;
  client: HarnessClient;
}

export interface AgentOsTurnResult {
  text: string;
  isError?: boolean;
  passthrough?: Json;
}

function dataDir(): string | undefined {
  const dir = process.env.MAXIMUS_DATA_DIR;
  return dir && dir.trim() ? dir : undefined;
}

export function boundAgentOsMachine(botId: string, threadId: string): {
  machineId: string;
  name: string;
  kind: string;
  online: boolean;
  local: boolean;
} | null {
  const dir = dataDir();
  if (!dir) return null;
  const os = agentOsForDir(dir);
  const assignment = os.assignmentFor({ threadId, botId });
  if (!assignment) return null;
  const machine = os.find(assignment.machineId);
  if (!machine) return null;
  return {
    machineId: machine.id,
    name: machine.name,
    kind: machine.kind,
    online: machine.online,
    local: machine.id === os.selfId,
  };
}

export async function callAgentOsBoundTool(
  name: string,
  args: Json,
  context: AgentOsTurnContext,
): Promise<AgentOsTurnResult | null> {
  if (name !== "list_shared_computers" && name !== "shared_computer" && name !== "select_computer" && name !== "agent_os") return null;
  const bound = boundAgentOsMachine(context.botId, context.threadId);
  if (name === "list_shared_computers") {
    if (!context.sharedComputers) {
      return { text: "Computer sharing is turned off in this workspace. There are no shared computers to use.", isError: true };
    }
    const listed = await context.client.api("/api/internal/shared-computers");
    if (bound && !bound.online) {
      return {
        text: JSON.stringify({
          ...listed,
          wait: true,
          runsOn: { machineId: bound.machineId, name: bound.name, online: false },
          say: `${bound.name} is asleep. Wake that computer, then try again.`,
        }),
        isError: true,
      };
    }
    return { text: JSON.stringify(bound ? { ...listed, runsOn: { machineId: bound.machineId, name: bound.name, online: bound.online } } : listed) };
  }
  if (name === "shared_computer") {
    if (!context.sharedComputers) {
      return { text: "Computer sharing is turned off in this workspace. There are no shared computers to use.", isError: true };
    }
    if (bound && !bound.online) {
      return {
        text: JSON.stringify({ wait: true, machineId: bound.machineId, name: bound.name, say: `${bound.name} is asleep. Wake that computer, then try again.` }),
        isError: true,
      };
    }
    const body = bound && !bound.local && !args.computer_id ? { ...args, computer_id: bound.machineId } : args;
    const response = await context.client.api("/api/internal/shared-computers", { method: "POST", body: JSON.stringify(body) });
    const result = response.result as Json;
    if (Array.isArray(result?.content)) return { text: "", passthrough: result };
    return { text: JSON.stringify(result) };
  }
  if (name === "agent_os") {
    const dir = dataDir();
    if (!dir) return { text: "This server has no data directory.", isError: true };
    const mode = typeof args.mode === "string" ? args.mode : "";
    const app = typeof args.app === "string" ? args.app : "";
    const action = typeof args.action === "string" ? args.action : "";
    if (!(AGENT_OS_PLUGIN_MODES as readonly string[]).includes(mode) || !app || !action) {
      return { text: "Need mode, app, and action. Do not send a password.", isError: true };
    }
    const invoked = await agentOsForDir(dir).invoke({
      actor: context.botId || "turn",
      personId: context.botId || "turn",
      mode: mode as (typeof AGENT_OS_PLUGIN_MODES)[number],
      app,
      action,
      confirm: args.confirm === true,
      threadId: context.threadId,
      botId: context.botId,
      client: "desktop",
    });
    if (!invoked.ok) {
      return {
        text: JSON.stringify({ error: invoked.error, ...(invoked.wait ? { wait: invoked.wait } : {}) }),
        isError: true,
      };
    }
    return { text: JSON.stringify(invoked.result) };
  }
  if (name === "select_computer") {
    if (bound && !bound.online) {
      return {
        text: JSON.stringify({ wait: true, machineId: bound.machineId, name: bound.name, say: `${bound.name} is asleep. Wake that computer, then try again.` }),
        isError: true,
      };
    }
    if (bound && !bound.local) {
      return {
        text: JSON.stringify({
          runsOn: bound.machineId,
          name: bound.name,
          dispatch: "shared-computer",
          leasePath: `/api/shared-computers/${bound.machineId}/lease`,
          say: `Use shared_computer with computer_id ${bound.machineId}. Do not drive this phone or hosted web.`,
        }),
      };
    }
    return null;
  }
  return null;
}
