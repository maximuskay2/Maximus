// Multi-tenant workspaces (roadmap Track 3, contracts sections 2/4/6):
// sign-up, team invitations, admin/member roles and workspace boundaries.
// Every read/write checks membership first: a non-member gets 404, never a
// hint the workspace exists. Writes need the admin role. Provider policies
// persist the Track 2 switchboard's workspace level (env-backed there).
import { z } from "zod";

import type { ControlPlaneAuth } from "./auth";
import { accountSession } from "./auth";
import { contractJSON } from "./contract";
import { degradeExpiredGrace, entitlementView, PLAN_CATALOG, transitionForBillingEvent, type BillingEvent, type WorkspaceEntitlementState } from "./entitlements";
import { planDef } from "./plan-catalog";
import { HTTPError, readBoundedJSON } from "./http";

export const WORKSPACE_ID = /^[a-z][a-z0-9-]{1,30}$/;
/** Per-workspace token (contracts section 7): read-only sync auth for the workspace server. */
export const WORKSPACE_TOKEN = /^maximus_workspace_[A-Za-z0-9_-]{43}$/;
export const PROVIDER_IDS = ["claude", "codex", "grok", "kimi", "muse"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type WorkspaceRole = "admin" | "member";
export const WORKSPACE_ROLES: readonly WorkspaceRole[] = ["admin", "member"];

const MAX_PROVIDERS = PROVIDER_IDS.length;
const MAX_MODELS_EACH = 100;
const MAX_CATALOG_BYTES = 64 * 1024;
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
const INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function isKnownProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

function missingTable(error: unknown): boolean {
  return error instanceof Error && /no such table/i.test(error.message);
}

function unavailable(error: unknown): HTTPError | null {
  return missingTable(error) ? new HTTPError(503, "workspaces_unavailable") : null;
}

interface WorkspaceRow {
  id: string;
  owner_user_id: string;
  display_name: string;
  plan: string;
  entitlements: string;
  allowance: number | null;
  status: string;
  grace_ends_at: number | null;
  created_at: number;
  updated_at: number;
}

function parseEntitlements(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function stateOf(row: WorkspaceRow): WorkspaceEntitlementState {
  return {
    workspace: row.id,
    plan: row.plan,
    entitlements: parseEntitlements(row.entitlements),
    allowance: row.allowance,
    status: row.status === "grace" ? "grace" : row.status === "suspended" ? "suspended" : "active",
    graceEndsAt: row.grace_ends_at,
  };
}

function cleanModels(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_MODELS_EACH) return null;
  const models: string[] = [];
  const seen = new Set<string>();
  for (const model of value) {
    if (typeof model !== "string" || !model || model.length > 160 || model.trim() !== model) return null;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/.test(model)) return null;
    if (seen.has(model)) continue;
    seen.add(model);
    models.push(model);
  }
  return models;
}

const signupSchema = z.strictObject({
  workspace: z.string().min(2).max(31).regex(WORKSPACE_ID),
  displayName: z.string().trim().min(1).max(80).optional(),
  plan: z.string().min(1).max(64).optional(),
});

const inviteSchema = z.strictObject({
  workspace: z.string().min(2).max(31).regex(WORKSPACE_ID),
  email: z.email().max(320),
  role: z.enum(["admin", "member"]),
});

const acceptSchema = z.strictObject({ token: z.string().regex(INVITE_TOKEN) });

const revokeSchema = z.strictObject({
  workspace: z.string().min(2).max(31).regex(WORKSPACE_ID),
  userId: z.string().min(1).max(256).optional(),
  inviteId: z.string().min(1).max(64).optional(),
});

const workspaceUpdateSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80).optional(),
  plan: z.string().min(1).max(64).optional(),
}).refine((value) => value.displayName !== undefined || value.plan !== undefined, { message: "nothing to update" });

const providerEntrySchema = z.strictObject({
  mode: z.enum(["byo", "bundled", "off"]),
  models: z.array(z.unknown()).optional(),
});

const providersUpdateSchema = z.record(z.string(), providerEntrySchema);

const operatorEntrySchema = z.strictObject({
  enabled: z.boolean(),
  reason: z.string().trim().min(1).max(300).optional(),
});

function base64URL(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64URL(bytes);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requireAccount(request: Request, auth: ControlPlaneAuth) {
  const session = await accountSession(request, auth);
  if (!session) throw new HTTPError(401, "unauthorized");
  return session;
}

async function requireMember(env: Env, workspace: string, userId: string): Promise<WorkspaceRole> {
  const row = await env.DB.prepare(
    "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
  ).bind(workspace, userId).first<{ role: string }>();
  if (!row || (row.role !== "admin" && row.role !== "member")) throw new HTTPError(404, "not_found");
  return row.role;
}

async function requireAdmin(env: Env, workspace: string, userId: string): Promise<void> {
  const role = await requireMember(env, workspace, userId);
  if (role !== "admin") throw new HTTPError(403, "forbidden");
}

async function requireWorkspace(env: Env, workspace: string): Promise<WorkspaceRow> {
  const row = await env.DB.prepare("SELECT * FROM workspaces WHERE id = ?").bind(workspace).first<WorkspaceRow>();
  if (!row) throw new HTTPError(404, "not_found");
  return row;
}

function bearerToken(request: Request): string | null {
  return request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? null;
}

/** True when the request carries this workspace's active token. Read-only sync calls accept it; writes need a member session. */
async function tokenWorkspace(env: Env, request: Request, workspace: string): Promise<boolean> {
  const presented = bearerToken(request);
  if (!presented || !WORKSPACE_TOKEN.test(presented)) return false;
  const row = await env.DB.prepare(
    "SELECT workspace_id FROM workspace_tokens WHERE token_hash = ? AND revoked_at IS NULL",
  ).bind(await sha256Hex(presented)).first<{ workspace_id: string }>();
  if (!row || row.workspace_id !== workspace) return false;
  await env.DB.prepare("UPDATE workspace_tokens SET last_used_at = ? WHERE token_hash = ?")
    .bind(Date.now(), await sha256Hex(presented)).run();
  return true;
}

/** Member session (any role) or the workspace's own token. */
async function requireMemberOrToken(request: Request, env: Env, auth: ControlPlaneAuth, workspace: string): Promise<void> {
  if (await tokenWorkspace(env, request, workspace).catch(() => false)) return;
  const session = await accountSession(request, auth);
  if (!session) throw new HTTPError(401, "unauthorized");
  await requireMember(env, workspace, session.user.id);
}

/** POST /api/workspaces/{id}/token: an admin (re)issues the workspace token; prior tokens rotate out. */
export async function issueWorkspaceToken(request: Request, workspace: string, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  const session = await requireAccount(request, auth);
  if (!WORKSPACE_ID.test(workspace)) throw new HTTPError(404, "not_found");
  try {
    await requireWorkspace(env, workspace);
    await requireAdmin(env, workspace, session.user.id);
    const token = `maximus_workspace_${randomToken()}`;
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("UPDATE workspace_tokens SET revoked_at = ? WHERE workspace_id = ? AND revoked_at IS NULL").bind(now, workspace),
      env.DB.prepare("INSERT INTO workspace_tokens (workspace_id, token_hash, created_at) VALUES (?, ?, ?)")
        .bind(workspace, await sha256Hex(token), now),
    ]);
    await audit(env, workspace, session.user.email, "token.issued", {});
    return contractJSON({ token: { workspace, token } }, 201);
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw unavailable(error) ?? error;
  }
}

export async function audit(env: Env, workspace: string, actor: string, action: string, detail: Record<string, unknown> = {}): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO workspace_audit_log (id, workspace_id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), workspace, actor.slice(0, 320), action.slice(0, 64), JSON.stringify(detail).slice(0, 8192), Date.now()).run();
}

function workspaceJSON(row: WorkspaceRow, role: WorkspaceRole) {
  return {
    id: row.id,
    displayName: row.display_name,
    plan: row.plan,
    role,
    status: row.status,
    ...(row.status !== "active" && row.grace_ends_at !== null ? { graceEndsAt: row.grace_ends_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** POST /api/auth/signup: an authenticated user founds a workspace and becomes its admin. */
export async function signup(request: Request, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  const session = await requireAccount(request, auth);
  const parsed = signupSchema.safeParse(await readBoundedJSON(request));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  const { workspace, displayName, plan } = parsed.data;
  const now = Date.now();
  try {
    const existing = await env.DB.prepare("SELECT id FROM workspaces WHERE id = ?").bind(workspace).first();
    if (existing) throw new HTTPError(409, "conflict");
    const seed = await planDef(env, plan ?? "free");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO workspaces (id, owner_user_id, display_name, plan, entitlements, allowance, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)",
      ).bind(workspace, session.user.id, displayName ?? workspace, plan ?? "free", JSON.stringify(seed.entitlements), seed.allowance, now, now),
      env.DB.prepare(
        "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)",
      ).bind(workspace, session.user.id, now),
    ]);
    await audit(env, workspace, session.user.email, "workspace.created", { plan: plan ?? "free" });
    const row = await requireWorkspace(env, workspace);
    return contractJSON({ workspace: workspaceJSON(row, "admin") }, 201);
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw unavailable(error) ?? error;
  }
}

/** GET /api/auth/memberships: every workspace the signed-in account belongs to, newest first. */
export async function listMemberships(request: Request, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  const session = await requireAccount(request, auth);
  try {
    const rows = await env.DB.prepare(
      `SELECT w.id AS id, w.display_name AS displayName, w.plan AS plan, w.status AS status,
              m.role AS role, m.created_at AS createdAt
         FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = ? ORDER BY m.created_at DESC`,
    ).bind(session.user.id).all<{
      id: string; displayName: string; plan: string; status: string; role: string; createdAt: number;
    }>();
    return contractJSON({
      memberships: rows.results
        .filter((row) => WORKSPACE_ID.test(row.id) && (row.role === "admin" || row.role === "member"))
        .map((row) => ({ workspace: row.id, displayName: row.displayName, plan: row.plan, status: row.status, role: row.role })),
    });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw unavailable(error) ?? error;
  }
}

/** POST /api/auth/invite: a workspace admin invites someone by email. */
export async function invite(request: Request, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  const session = await requireAccount(request, auth);
  const parsed = inviteSchema.safeParse(await readBoundedJSON(request));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  const { workspace, email, role } = parsed.data;
  try {
    await requireWorkspace(env, workspace);
    await requireAdmin(env, workspace, session.user.id);
    const token = randomToken();
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO workspace_invites (id, workspace_id, email, role, token_hash, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), workspace, email.toLowerCase(), role, await sha256Hex(token), session.user.id, now + INVITE_TTL_MS, now).run();
    await audit(env, workspace, session.user.email, "member.invited", { email, role });
    return contractJSON({ invite: { workspace, email, role, expiresAt: now + INVITE_TTL_MS }, token }, 201);
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw unavailable(error) ?? error;
  }
}

/** POST /api/auth/invite/accept: the invited email joins the workspace. Single-use token. */
export async function acceptInvite(request: Request, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  const session = await requireAccount(request, auth);
  const parsed = acceptSchema.safeParse(await readBoundedJSON(request));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  try {
    const row = await env.DB.prepare(
      "SELECT * FROM workspace_invites WHERE token_hash = ?",
    ).bind(await sha256Hex(parsed.data.token)).first<{
      id: string; workspace_id: string; email: string; role: string; expires_at: number; accepted_at: number | null; revoked_at: number | null;
    }>();
    const now = Date.now();
    if (!row || row.accepted_at !== null || row.revoked_at !== null || now >= row.expires_at) {
      throw new HTTPError(404, "not_found");
    }
    if (row.email !== session.user.email.toLowerCase()) throw new HTTPError(403, "forbidden");
    await env.DB.batch([
      env.DB.prepare("UPDATE workspace_invites SET accepted_at = ? WHERE id = ?").bind(now, row.id),
      env.DB.prepare(
        "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role",
      ).bind(row.workspace_id, session.user.id, row.role, now),
    ]);
    await audit(env, row.workspace_id, session.user.email, "member.joined", { role: row.role });
    const workspace = await requireWorkspace(env, row.workspace_id);
    return contractJSON({ workspace: workspaceJSON(workspace, row.role as WorkspaceRole) });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw unavailable(error) ?? error;
  }
}

/**
 * POST /api/auth/revoke: an admin removes a member (or revokes an invite);
 * anyone may leave a workspace themselves. The owner cannot be removed while
 * other admins exist is not enforced — the last admin cannot remove themselves.
 */
export async function revoke(request: Request, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  const session = await requireAccount(request, auth);
  const parsed = revokeSchema.safeParse(await readBoundedJSON(request));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  const { workspace, userId, inviteId } = parsed.data;
  try {
    const row = await requireWorkspace(env, workspace);
    const selfRole = await requireMember(env, workspace, session.user.id);
    if (inviteId !== undefined) {
      if (selfRole !== "admin") throw new HTTPError(403, "forbidden");
      const updated = await env.DB.prepare(
        "UPDATE workspace_invites SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL AND accepted_at IS NULL",
      ).bind(Date.now(), inviteId, workspace).run();
      if ((updated.meta.changes ?? 0) === 0) throw new HTTPError(404, "not_found");
      await audit(env, workspace, session.user.email, "member.invite_revoked", { inviteId });
      return contractJSON({ revoked: true });
    }
    const target = userId ?? session.user.id;
    const leaving = target === session.user.id;
    if (!leaving && selfRole !== "admin") throw new HTTPError(403, "forbidden");
    if (target === row.owner_user_id) throw new HTTPError(409, "conflict");
    if (leaving && selfRole === "admin") {
      const admins = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = ? AND role = 'admin'",
      ).bind(workspace).first<{ count: number }>();
      if ((admins?.count ?? 0) <= 1) throw new HTTPError(409, "conflict");
    }
    const removed = await env.DB.prepare(
      "DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
    ).bind(workspace, target).run();
    if ((removed.meta.changes ?? 0) === 0) throw new HTTPError(404, "not_found");
    await audit(env, workspace, session.user.email, leaving ? "member.left" : "member.removed", leaving ? {} : { userId: target });
    return contractJSON({ revoked: true });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw unavailable(error) ?? error;
  }
}

/** GET /api/workspaces/{id}: member view. Non-members get 404 (boundary). */
export async function getWorkspace(request: Request, workspace: string, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  const session = await requireAccount(request, auth);
  if (!WORKSPACE_ID.test(workspace)) throw new HTTPError(404, "not_found");
  try {
    const role = await requireMember(env, workspace, session.user.id);
    const row = await requireWorkspace(env, workspace);
    return contractJSON({ workspace: workspaceJSON(row, role) });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw unavailable(error) ?? error;
  }
}

/** PUT /api/workspaces/{id}: admin updates display name or plan (plan changes re-seed entitlements). */
export async function updateWorkspace(request: Request, workspace: string, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  const session = await requireAccount(request, auth);
  if (!WORKSPACE_ID.test(workspace)) throw new HTTPError(404, "not_found");
  const parsed = workspaceUpdateSchema.safeParse(await readBoundedJSON(request));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  try {
    const row = await requireWorkspace(env, workspace);
    await requireAdmin(env, workspace, session.user.id);
    const now = Date.now();
    const plan = parsed.data.plan ?? row.plan;
    const seed = parsed.data.plan !== undefined && parsed.data.plan !== row.plan ? await planDef(env, parsed.data.plan) : null;
    await env.DB.prepare(
      "UPDATE workspaces SET display_name = ?, plan = ?, entitlements = ?, allowance = ?, updated_at = ? WHERE id = ?",
    ).bind(
      parsed.data.displayName ?? row.display_name,
      plan,
      seed ? JSON.stringify(seed.entitlements) : row.entitlements,
      seed ? seed.allowance : row.allowance,
      now,
      workspace,
    ).run();
    await audit(env, workspace, session.user.email, "workspace.updated", { ...(parsed.data.displayName ? { displayName: parsed.data.displayName } : {}), ...(seed ? { plan } : {}) });
    const updated = await requireWorkspace(env, workspace);
    return contractJSON({ workspace: workspaceJSON(updated, "admin") });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw unavailable(error) ?? error;
  }
}

interface PolicyRow {
  provider_id: string;
  mode: string;
  models: string;
}

export type WorkspaceProviderView = Record<string, { mode: "byo" | "bundled" | "off"; models: string[] }>;

export async function readWorkspaceProviders(env: Env, workspace: string): Promise<WorkspaceProviderView> {
  const rows = await env.DB.prepare(
    "SELECT provider_id, mode, models FROM workspace_provider_policies WHERE workspace_id = ?",
  ).bind(workspace).all<PolicyRow>();
  const view: WorkspaceProviderView = {};
  for (const id of PROVIDER_IDS) view[id] = { mode: "byo", models: [] };
  for (const row of rows.results) {
    if (!isKnownProviderId(row.provider_id)) continue;
    const mode = row.mode === "bundled" || row.mode === "off" ? row.mode : "byo";
    view[row.provider_id] = { mode, models: mode === "bundled" ? parseEntitlements(row.models) : [] };
  }
  return view;
}

function checkProviderUpdate(body: unknown): { mode: "byo" | "bundled" | "off"; models: string[] } | null {
  const parsed = providerEntrySchema.safeParse(body);
  if (!parsed.success) return null;
  if (parsed.data.mode === "bundled") {
    const models = cleanModels(parsed.data.models ?? []);
    if (models === null || !models.length) return null;
    if (JSON.stringify(models).length > MAX_CATALOG_BYTES) return null;
    return { mode: "bundled", models };
  }
  return { mode: parsed.data.mode, models: [] };
}

/** GET /api/workspaces/{id}/providers: the workspace switchboard level + BYO-vs-bundled routing view. */
export async function getWorkspaceProviders(request: Request, workspace: string, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  if (!WORKSPACE_ID.test(workspace)) throw new HTTPError(404, "not_found");
  try {
    await requireMemberOrToken(request, env, auth, workspace);
    await requireWorkspace(env, workspace);
    const operator = await readOperatorProviders(env);
    const providers = await readWorkspaceProviders(env, workspace);
    const routing: Record<string, { allowed: boolean; via: "byo" | "bundled" | "off"; reason?: string; models?: string[] }> = {};
    for (const id of PROVIDER_IDS) {
      const kill = operator[id];
      if (kill && !kill.enabled) {
        routing[id] = { allowed: false, via: "off", reason: kill.reason ?? `${id} is turned off by the operator.` };
        continue;
      }
      const entry = providers[id];
      if (entry.mode === "off") routing[id] = { allowed: false, via: "off", reason: `${id} is turned off for this workspace.` };
      else if (entry.mode === "bundled") routing[id] = { allowed: true, via: "bundled", models: entry.models };
      else routing[id] = { allowed: true, via: "byo" };
    }
    return contractJSON({ workspace, providers, routing });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw unavailable(error) ?? error;
  }
}

async function writeWorkspaceProvider(
  env: Env,
  workspace: string,
  providerId: ProviderId,
  entry: { mode: "byo" | "bundled" | "off"; models: string[] },
  actor: string,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO workspace_provider_policies (workspace_id, provider_id, mode, models, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id, provider_id) DO UPDATE SET mode = excluded.mode, models = excluded.models, updated_at = excluded.updated_at",
  ).bind(workspace, providerId, entry.mode, JSON.stringify(entry.models), Date.now()).run();
  await audit(env, workspace, actor, "providers.updated", { provider: providerId, mode: entry.mode, models: entry.models.length });
}

/** PUT /api/workspaces/{id}/providers and PUT .../providers/{providerId}: admin toggles. */
export async function updateWorkspaceProviders(request: Request, workspace: string, providerId: string | null, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  const session = await requireAccount(request, auth);
  if (!WORKSPACE_ID.test(workspace)) throw new HTTPError(404, "not_found");
  if (providerId !== null && !isKnownProviderId(providerId)) throw new HTTPError(404, "not_found");
  const body = await readBoundedJSON(request);
  try {
    await requireWorkspace(env, workspace);
    await requireAdmin(env, workspace, session.user.id);
    if (providerId !== null) {
      const entry = checkProviderUpdate(body);
      if (!entry) throw new HTTPError(400, "invalid_request");
      await writeWorkspaceProvider(env, workspace, providerId, entry, session.user.email);
    } else {
      const parsed = providersUpdateSchema.safeParse(body);
      if (!parsed.success || Object.keys(parsed.data).length > MAX_PROVIDERS) throw new HTTPError(400, "invalid_request");
      const entries = new Map<ProviderId, { mode: "byo" | "bundled" | "off"; models: string[] }>();
      for (const [id, value] of Object.entries(parsed.data)) {
        if (!isKnownProviderId(id)) throw new HTTPError(400, "invalid_request");
        const entry = checkProviderUpdate(value);
        if (!entry) throw new HTTPError(400, "invalid_request");
        entries.set(id, entry);
      }
      if (!entries.size) throw new HTTPError(400, "invalid_request");
      for (const [id, entry] of entries) await writeWorkspaceProvider(env, workspace, id, entry, session.user.email);
    }
    return contractJSON({ workspace, providers: await readWorkspaceProviders(env, workspace) });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw unavailable(error) ?? error;
  }
}

export type OperatorView = Record<string, { enabled: boolean; reason?: string }>;

export async function readOperatorProviders(env: Env): Promise<OperatorView> {
  const rows = await env.DB.prepare("SELECT provider_id, enabled, reason FROM operator_provider_policies").all<{
    provider_id: string; enabled: number; reason: string | null;
  }>();
  const view: OperatorView = {};
  for (const row of rows.results) {
    if (!isKnownProviderId(row.provider_id)) continue;
    view[row.provider_id] = row.reason ? { enabled: row.enabled === 1, reason: row.reason } : { enabled: row.enabled === 1 };
  }
  return view;
}

/** The operator kill-switch is a separate credential from any workspace admin. */
function requireOperatorToken(request: Request, env: Env): void {
  const token = (env as unknown as Record<string, unknown>).MAXIMUS_OPERATOR_TOKEN;
  if (typeof token !== "string" || !token) throw new HTTPError(503, "operator_unavailable");
  const presented = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!presented) throw new HTTPError(401, "unauthorized");
  if (presented !== token) throw new HTTPError(403, "forbidden");
}

/** GET /api/operator/providers: any signed-in account reads the kill-switches. */
export async function getOperatorProviders(request: Request, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  await requireAccount(request, auth);
  try {
    return contractJSON({ providers: await readOperatorProviders(env) });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw unavailable(error) ?? error;
  }
}

/** PUT /api/operator/providers[/{providerId}]: the operator token alone authenticates (no workspace session). */
export async function updateOperatorProviders(request: Request, providerId: string | null, env: Env): Promise<Response> {
  requireOperatorToken(request, env);
  if (providerId !== null && !isKnownProviderId(providerId)) throw new HTTPError(404, "not_found");
  const body = await readBoundedJSON(request);
  try {
    const entries = new Map<ProviderId, { enabled: boolean; reason?: string }>();
    if (providerId !== null) {
      const parsed = operatorEntrySchema.safeParse(body);
      if (!parsed.success) throw new HTTPError(400, "invalid_request");
      entries.set(providerId, { enabled: parsed.data.enabled, ...(parsed.data.reason ? { reason: parsed.data.reason } : {}) });
    } else {
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new HTTPError(400, "invalid_request");
      const keys = Object.keys(body as Record<string, unknown>);
      if (!keys.length || keys.length > MAX_PROVIDERS) throw new HTTPError(400, "invalid_request");
      for (const [id, value] of Object.entries(body as Record<string, unknown>)) {
        if (!isKnownProviderId(id)) throw new HTTPError(400, "invalid_request");
        const parsed = operatorEntrySchema.safeParse(value);
        if (!parsed.success) throw new HTTPError(400, "invalid_request");
        entries.set(id, { enabled: parsed.data.enabled, ...(parsed.data.reason ? { reason: parsed.data.reason } : {}) });
      }
    }
    const now = Date.now();
    for (const [id, entry] of entries) {
      await env.DB.prepare(
        "INSERT INTO operator_provider_policies (provider_id, enabled, reason, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(provider_id) DO UPDATE SET enabled = excluded.enabled, reason = excluded.reason, updated_at = excluded.updated_at",
      ).bind(id, entry.enabled ? 1 : 0, entry.reason ?? null, now).run();
    }
    return contractJSON({ providers: await readOperatorProviders(env) });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw unavailable(error) ?? error;
  }
}

/** GET /api/workspaces/{id}/entitlements: the synced entitlement view (plan, granted ids, grace banner). */
export async function getEntitlements(request: Request, workspace: string, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  if (!WORKSPACE_ID.test(workspace)) throw new HTTPError(404, "not_found");
  try {
    await requireMemberOrToken(request, env, auth, workspace);
    const row = await requireWorkspace(env, workspace);
    const now = Date.now();
    const degraded = degradeExpiredGrace(stateOf(row), now);
    if (degraded.degraded) {
      await env.DB.prepare(
        "UPDATE workspaces SET entitlements = ?, allowance = ?, status = 'suspended', updated_at = ? WHERE id = ?",
      ).bind(JSON.stringify(degraded.entitlements), degraded.allowance, now, workspace).run();
      await audit(env, workspace, "billing", "entitlements.degraded", { reason: "grace_expired" });
    }
    const current = degraded.degraded
      ? { ...stateOf(row), entitlements: degraded.entitlements, allowance: degraded.allowance, status: "suspended" as const }
      : stateOf(row);
    return contractJSON({ entitlements: entitlementView(current, now) });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw unavailable(error) ?? error;
  }
}

/** GET /api/workspaces/{id}/spend: month spend vs allowance burn-down. */
export async function getSpend(request: Request, workspace: string, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  if (!WORKSPACE_ID.test(workspace)) throw new HTTPError(404, "not_found");
  try {
    await requireMemberOrToken(request, env, auth, workspace);
    const row = await requireWorkspace(env, workspace);
    const period = new Date().toISOString().slice(0, 7);
    const spend = await env.DB.prepare(
      "SELECT amount FROM workspace_spend WHERE workspace_id = ? AND period = ?",
    ).bind(workspace, period).first<{ amount: number }>();
    const spent = spend?.amount ?? 0;
    return contractJSON({
      spend: {
        workspace,
        period,
        spent,
        allowance: row.allowance,
        remaining: row.allowance === null ? null : Math.max(0, row.allowance - spent),
        overage: row.allowance === null ? 0 : Math.max(0, spent - row.allowance),
      },
    });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw unavailable(error) ?? error;
  }
}

/**
 * Applies one normalized billing event (contracts section 5) to a workspace.
 * Idempotency key is `{provider}:{event_id}`; duplicate deliveries are
 * acknowledged without re-applying. Track 4's webhook routes call this.
 */
export async function applyBillingEvent(env: Env, event: BillingEvent, now = Date.now()): Promise<{ applied: boolean; view: ReturnType<typeof entitlementView> }> {
  const row = await requireWorkspace(env, event.workspace_id);
  const key = `${event.provider}:${event.event_id}`;
  const seen = await env.DB.prepare(
    "SELECT id FROM workspace_audit_log WHERE workspace_id = ? AND action = 'billing.event' AND detail LIKE ? LIMIT 1",
  ).bind(event.workspace_id, `%${JSON.stringify(key).slice(1, -1)}%`).first();
  if (seen) return { applied: false, view: entitlementView(stateOf(row), now) };
  let appliedEvent = event;
  if (event.plan in PLAN_CATALOG && event.entitlements.length === 0 && event.allowance == null) {
    const stored = await planDef(env, event.plan);
    appliedEvent = { ...event, entitlements: [...stored.entitlements], allowance: stored.allowance };
  }
  const next = transitionForBillingEvent(stateOf(row), appliedEvent, now);
  await env.DB.prepare(
    "UPDATE workspaces SET plan = ?, entitlements = ?, allowance = ?, status = ?, grace_ends_at = ?, updated_at = ? WHERE id = ?",
  ).bind(next.plan, JSON.stringify(next.entitlements), next.allowance, next.status, next.graceEndsAt, now, event.workspace_id).run();
  await audit(env, event.workspace_id, "billing", "billing.event", { key, type: event.type, plan: next.plan });
  const updated = await requireWorkspace(env, event.workspace_id);
  return { applied: next.changed, view: entitlementView(stateOf(updated), now) };
}
