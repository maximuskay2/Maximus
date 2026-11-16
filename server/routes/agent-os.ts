import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import {
  AGENT_OS_CAPABILITIES,
  AGENT_OS_MACHINE_KINDS,
  AGENT_OS_PLUGIN_MODES,
  type AgentOsCapability,
} from "../../shared/agent-os.ts";
import { agentOsForDir, type AgentOsHost } from "../agent-os.ts";
import { ownerOrAdmin, type RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const BODY_LIMIT = 16_384;
const heartbeatSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(AGENT_OS_MACHINE_KINDS),
  capabilities: z.array(z.enum(AGENT_OS_CAPABILITIES)).max(8).optional(),
});
const assignmentSchema = z.object({
  machineId: z.string().min(1).max(80),
  threadId: z.string().min(1).max(80).optional(),
  botId: z.string().min(1).max(80).optional(),
});
const routeSchema = z.object({
  machineId: z.string().min(1).max(80),
  capability: z.enum(AGENT_OS_CAPABILITIES),
  threadId: z.string().min(1).max(80).optional(),
  botId: z.string().min(1).max(80).optional(),
});
const policySchema = z.object({
  bots: z.array(z.string().min(1).max(80)).max(200),
  machines: z.array(z.string().min(1).max(80)).max(40),
  capabilities: z.array(z.enum(AGENT_OS_CAPABILITIES)).max(8),
});
const invokeSchema = z.object({
  mode: z.enum(AGENT_OS_PLUGIN_MODES),
  app: z.string().min(1).max(40),
  action: z.string().min(1).max(40),
  machineId: z.string().min(1).max(80).optional(),
  botId: z.string().min(1).max(80).optional(),
  threadId: z.string().min(1).max(80).optional(),
  confirm: z.boolean().optional(),
  args: z.record(z.string().min(1).max(40), z.string().max(2_000)).optional(),
}).strict();

function actorOf(auth: RequestAuth): string {
  if (auth.kind === "session") return auth.session.email || auth.session.userId || auth.session.id;
  return "owner";
}

function dispatchOf(target: "local" | "remote", kind: string): "cua" | "cloud-home" | "shared-computer" {
  if (target === "local") return kind === "cloud_home" ? "cloud-home" : "cua";
  return "shared-computer";
}

export function createAgentOsRoutes(deps: { dataDir?: string; os?: AgentOsHost } = {}): RouteHandler {
  const dataDir = deps.dataDir ?? process.env.MAXIMUS_DATA_DIR ?? join(homedir(), ".maximus");
  const os = () => deps.os ?? agentOsForDir(dataDir);
  return async (ctx) => {
    const { req, res, url, path, method, auth, json, readBody } = ctx;
    if (!path.startsWith("/api/agent-os")) return PASS;
    res.setHeader("cache-control", "private, no-store");
    const host = os();

    if (path === "/api/agent-os/machines" && method === "GET") {
      return json(res, 200, host.payload());
    }

    if (path === "/api/agent-os/heartbeat" && method === "POST") {
      let body: unknown;
      try { body = await readBody(req, BODY_LIMIT); } catch { return json(res, 400, { error: "Could not read heartbeat." }); }
      const parsed = heartbeatSchema.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "Invalid heartbeat." });
      if (parsed.data.id !== host.selfId && parsed.data.kind !== "this_desktop" && parsed.data.kind !== "cloud_home" && !host.payload().multiMachine) {
        return json(res, 403, { error: "Subscribe to Your model to use Agent OS. The monthly fee is this computer; your provider bills the tokens." });
      }
      return json(res, 200, host.heartbeat(parsed.data));
    }

    if (path === "/api/agent-os/assignment" && method === "GET") {
      const threadId = url.searchParams.get("threadId") ?? undefined;
      const botId = url.searchParams.get("botId") ?? undefined;
      return json(res, 200, { assignment: host.assignmentFor({ threadId, botId }) });
    }

    if (path === "/api/agent-os/assignment" && method === "PUT") {
      let body: unknown;
      try { body = await readBody(req, BODY_LIMIT); } catch { return json(res, 400, { error: "Could not read assignment." }); }
      const parsed = assignmentSchema.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "Invalid assignment." });
      const next = host.assign(parsed.data);
      if ("error" in next) return json(res, 404, next);
      return json(res, 200, { assignment: next });
    }

    if (path === "/api/agent-os/route" && method === "POST") {
      let body: unknown;
      try { body = await readBody(req, BODY_LIMIT); } catch { return json(res, 400, { error: "Could not read route." }); }
      const parsed = routeSchema.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "Invalid route." });
      const result = host.route({ machineId: parsed.data.machineId, botId: parsed.data.botId, capability: parsed.data.capability as AgentOsCapability, actor: actorOf(auth) });
      if (!result.ok) {
        const status = result.outcome === "offline" ? 503 : result.outcome === "denied" ? 403 : 400;
        return json(res, status, {
          error: result.error,
          outcome: result.outcome,
          ...(result.machine ? { wait: { machineId: result.machine.id, name: result.machine.name } } : {}),
        });
      }
      return json(res, 200, {
        ok: true,
        target: result.target,
        dispatch: dispatchOf(result.target, result.machine.kind),
        machine: result.machine,
        leasePath: result.target === "remote" ? `/api/shared-computers/${result.machine.id}/lease` : undefined,
      });
    }

    if (path === "/api/agent-os/policy" && (method === "GET" || method === "PUT")) {
      if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only an admin can change Agent OS policy." });
      if (method === "GET") return json(res, 200, host.policy());
      let body: unknown;
      try { body = await readBody(req, BODY_LIMIT); } catch { return json(res, 400, { error: "Could not read policy." }); }
      const parsed = policySchema.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "Invalid policy." });
      return json(res, 200, host.writePolicy(parsed.data));
    }

    if (path === "/api/agent-os/audit" && method === "GET") {
      if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only an admin can read the Agent OS audit." });
      const limit = Number(url.searchParams.get("limit") ?? "50");
      return json(res, 200, { rows: host.audit(Number.isFinite(limit) ? Math.min(200, Math.max(1, limit)) : 50) });
    }

    if (path === "/api/agent-os/plugins" && method === "GET") {
      return json(res, 200, { plugins: host.plugins() });
    }

    if (path === "/api/agent-os/plugins/invoke" && method === "POST") {
      let body: unknown;
      try { body = await readBody(req, BODY_LIMIT); } catch { return json(res, 400, { error: "Could not read invoke." }); }
      if (body && typeof body === "object" && ("password" in body || "secret" in body)) {
        return json(res, 400, { error: "Do not send passwords. Sign in as yourself in the other app." });
      }
      const parsed = invokeSchema.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "Invalid plug-in call." });
      const personId = actorOf(auth);
      const result = await host.invoke({
        ...parsed.data,
        actor: personId,
        personId,
        client: auth.kind === "loopback" ? "desktop" : "remote",
      });
      if (!result.ok) {
        return json(res, result.status, { error: result.error, ...(result.wait ? { wait: result.wait } : {}) });
      }
      return json(res, 200, result.result);
    }

    return json(res, 404, { error: "Unknown Agent OS route." });
  };
}

export const agentOsRoutes: RouteHandler = createAgentOsRoutes();
