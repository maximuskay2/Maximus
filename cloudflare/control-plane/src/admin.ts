// Admin console API (roadmap Track 3, contracts section 6): seats,
// installations, audit log, spend metrics, entitlement/plan view, provider
// toggles per workspace (in workspaces.ts) and the BYO-vs-bundled routing
// view. Every endpoint is workspace-admin-only and workspace-scoped.
import type { ControlPlaneAuth } from "./auth";
import { contractJSON } from "./contract";
import { entitlementView } from "./entitlements";
import { HTTPError } from "./http";
import { readOperatorProviders, readWorkspaceProviders, requireAccount, WORKSPACE_ID } from "./workspaces";

function missingTable(error: unknown): boolean {
  return error instanceof Error && /no such table/i.test(error.message);
}

function workspaceParam(request: Request): string {
  const workspace = new URL(request.url).searchParams.get("workspace") ?? "";
  if (!WORKSPACE_ID.test(workspace)) throw new HTTPError(400, "invalid_request");
  return workspace;
}

async function requireWorkspaceAdmin(env: Env, workspace: string, userId: string): Promise<void> {
  try {
    const workspaceRow = await env.DB.prepare("SELECT id FROM workspaces WHERE id = ?").bind(workspace).first();
    if (!workspaceRow) throw new HTTPError(404, "not_found");
    const member = await env.DB.prepare(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
    ).bind(workspace, userId).first<{ role: string }>();
    if (!member) throw new HTTPError(404, "not_found");
    if (member.role !== "admin") throw new HTTPError(403, "forbidden");
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw missingTable(error) ? new HTTPError(503, "workspaces_unavailable") : error;
  }
}

/** GET /api/admin/seats?workspace=: member + invite counts and roster. */
export async function adminSeats(request: Request, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  const session = await requireAccount(request, auth);
  const workspace = workspaceParam(request);
  await requireWorkspaceAdmin(env, workspace, session.user.id);
  try {
    const members = await env.DB.prepare(
      `SELECT m.user_id AS userId, m.role AS role, m.created_at AS createdAt, u.email AS email, u.name AS name
         FROM workspace_members m JOIN "user" u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.created_at`,
    ).bind(workspace).all<{ userId: string; role: string; createdAt: number; email: string; name: string }>();
    const invites = await env.DB.prepare(
      "SELECT id, email, role, expires_at AS expiresAt, created_at AS createdAt FROM workspace_invites WHERE workspace_id = ? AND revoked_at IS NULL AND accepted_at IS NULL",
    ).bind(workspace).all<{ id: string; email: string; role: string; expiresAt: number; createdAt: number }>();
    return contractJSON({
      seats: {
        workspace,
        admins: members.results.filter((m) => m.role === "admin").length,
        members: members.results.filter((m) => m.role === "member").length,
        pendingInvites: invites.results.length,
        roster: members.results,
        invites: invites.results,
      },
    });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw missingTable(error) ? new HTTPError(503, "workspaces_unavailable") : error;
  }
}

/** GET /api/admin/installations?workspace=: installations owned by workspace members. */
export async function adminInstallations(request: Request, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  const session = await requireAccount(request, auth);
  const workspace = workspaceParam(request);
  await requireWorkspaceAdmin(env, workspace, session.user.id);
  try {
    const rows = await env.DB.prepare(
      `SELECT i.id AS id, i.client_instance_id AS clientInstanceId, i.display_name AS name,
              i.platform AS platform, i.app_version AS appVersion, i.created_at AS createdAt,
              i.last_seen_at AS lastSeenAt, u.email AS ownerEmail
         FROM installations i
         JOIN workspace_members m ON m.user_id = i.owner_user_id AND m.workspace_id = ?
         JOIN "user" u ON u.id = i.owner_user_id
        WHERE i.revoked_at IS NULL ORDER BY i.created_at`,
    ).bind(workspace).all<{
      id: string; clientInstanceId: string; name: string; platform: string; appVersion: string | null;
      createdAt: number; lastSeenAt: number | null; ownerEmail: string;
    }>();
    return contractJSON({ installations: { workspace, count: rows.results.length, installations: rows.results } });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw missingTable(error) ? new HTTPError(503, "workspaces_unavailable") : error;
  }
}

/** GET /api/admin/audit?workspace=&limit=: newest-first audit rows. */
export async function adminAudit(request: Request, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  const session = await requireAccount(request, auth);
  const url = new URL(request.url);
  const workspace = workspaceParam(request);
  await requireWorkspaceAdmin(env, workspace, session.user.id);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new HTTPError(400, "invalid_request");
  try {
    const rows = await env.DB.prepare(
      "SELECT id, actor, action, detail, created_at AS createdAt FROM workspace_audit_log WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
    ).bind(workspace, limit).all<{ id: string; actor: string; action: string; detail: string; createdAt: number }>();
    return contractJSON({
      audit: {
        workspace,
        entries: rows.results.map((row) => {
          let detail: unknown = {};
          try { detail = JSON.parse(row.detail); } catch { detail = {}; }
          return { id: row.id, actor: row.actor, action: row.action, detail, createdAt: row.createdAt };
        }),
      },
    });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw missingTable(error) ? new HTTPError(503, "workspaces_unavailable") : error;
  }
}

/** GET /api/admin/usage?workspace=: spend metrics + entitlement/plan view. */
export async function adminUsage(request: Request, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  const session = await requireAccount(request, auth);
  const workspace = workspaceParam(request);
  await requireWorkspaceAdmin(env, workspace, session.user.id);
  try {
    const row = await env.DB.prepare("SELECT * FROM workspaces WHERE id = ?").bind(workspace).first<{
      id: string; plan: string; entitlements: string; allowance: number | null; status: string; grace_ends_at: number | null;
    }>();
    if (!row) throw new HTTPError(404, "not_found");
    let carried: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.entitlements);
      if (Array.isArray(parsed)) carried = parsed.filter((id): id is string => typeof id === "string");
    } catch { carried = []; }
    const now = Date.now();
    const state = {
      workspace: row.id,
      plan: row.plan,
      entitlements: carried,
      allowance: row.allowance,
      status: (row.status === "grace" ? "grace" : row.status === "suspended" ? "suspended" : "active") as "active" | "grace" | "suspended",
      graceEndsAt: row.grace_ends_at,
    };
    const period = new Date().toISOString().slice(0, 7);
    const spend = await env.DB.prepare(
      "SELECT amount FROM workspace_spend WHERE workspace_id = ? AND period = ?",
    ).bind(workspace, period).first<{ amount: number }>();
    const spent = spend?.amount ?? 0;
    const history = await env.DB.prepare(
      "SELECT period, amount FROM workspace_spend WHERE workspace_id = ? ORDER BY period DESC LIMIT 12",
    ).bind(workspace).all<{ period: string; amount: number }>();
    return contractJSON({
      usage: {
        workspace,
        entitlements: entitlementView(state, now),
        spend: {
          period,
          spent,
          allowance: row.allowance,
          remaining: row.allowance === null ? null : Math.max(0, row.allowance - spent),
          overage: row.allowance === null ? 0 : Math.max(0, spent - row.allowance),
        },
        history: history.results,
      },
    });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw missingTable(error) ? new HTTPError(503, "workspaces_unavailable") : error;
  }
}

/** GET /api/admin/routing?workspace=: BYO-vs-bundled routing per provider (operator x workspace verdicts). */
export async function adminRouting(request: Request, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  const session = await requireAccount(request, auth);
  const workspace = workspaceParam(request);
  await requireWorkspaceAdmin(env, workspace, session.user.id);
  try {
    const operator = await readOperatorProviders(env);
    const providers = await readWorkspaceProviders(env, workspace);
    const routing: Record<string, { allowed: boolean; via: string; operatorEnabled: boolean; workspaceMode: string; reason?: string; models?: string[] }> = {};
    for (const [id, entry] of Object.entries(providers)) {
      const kill = operator[id];
      const operatorEnabled = !kill || kill.enabled;
      if (!operatorEnabled) {
        routing[id] = { allowed: false, via: "off", operatorEnabled, workspaceMode: entry.mode, reason: kill!.reason ?? `${id} is turned off by the operator.` };
      } else if (entry.mode === "off") {
        routing[id] = { allowed: false, via: "off", operatorEnabled, workspaceMode: entry.mode, reason: `${id} is turned off for this workspace.` };
      } else if (entry.mode === "bundled") {
        routing[id] = { allowed: true, via: "bundled", operatorEnabled, workspaceMode: entry.mode, models: entry.models };
      } else {
        routing[id] = { allowed: true, via: "byo", operatorEnabled, workspaceMode: entry.mode };
      }
    }
    return contractJSON({ routing: { workspace, providers: routing } });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw missingTable(error) ? new HTTPError(503, "workspaces_unavailable") : error;
  }
}
