// OIDC SSO (greenfield — upstream has none; contracts section 2 `sso`).
// A workspace admin registers their issuer + client and a scope mapping;
// the callback exchanges the code at the issuer and maps the identity's
// scopes/groups to a workspace role and session scopes. The mapping is pure
// (`mapOidcScopes`) so the server reuses the same semantics.
import type { AccountsEnv } from "./types.ts";
import { z } from "zod";

import type { ControlPlaneAuth } from "./auth.ts";
import { contractJSON } from "./contract.ts";
import { HTTPError, readBoundedJSON } from "./http.ts";
import { audit, requireAccount, WORKSPACE_ID } from "./workspaces.ts";

export type OidcRole = "admin" | "member";

/**
 * Scope mapping: OIDC scope/group names to workspace roles. `defaultRole`
 * applies when nothing matches; unknown scopes grant nothing beyond it.
 * Example: `{ "groups": { "maximus-admins": "admin" }, "scopes": { "admin": "admin" }, "defaultRole": "member" }`.
 */
export interface OidcScopeMapping {
  groups?: Record<string, OidcRole>;
  scopes?: Record<string, OidcRole>;
  defaultRole?: OidcRole;
}

export interface OidcIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  groups?: string[];
  scopes?: string[];
}

const roleSchema = z.enum(["admin", "member"]);
const mappingSchema = z.strictObject({
  groups: z.record(z.string().min(1).max(256), roleSchema).optional(),
  scopes: z.record(z.string().min(1).max(256), roleSchema).optional(),
  defaultRole: roleSchema.optional(),
});

const configSchema = z.strictObject({
  workspace: z.string().min(2).max(31).regex(WORKSPACE_ID),
  issuer: z.string().min(8).max(512).regex(/^https:\/\/[^/\s]+(\/\S*)?$/),
  clientId: z.string().min(1).max(256),
  mapping: mappingSchema.optional(),
  enabled: z.boolean().optional(),
});

const callbackSchema = z.strictObject({
  workspace: z.string().min(2).max(31).regex(WORKSPACE_ID),
  code: z.string().min(1).max(4096),
  redirectUri: z.string().min(8).max(1024).regex(/^https:\/\/\S+$/),
});

function missingTable(error: unknown): boolean {
  return error instanceof Error && /no such table|does not exist/i.test(error.message);
}

/** First admin match wins; otherwise the default role (member). Unknown scopes grant nothing. */
export function mapOidcScopes(mapping: OidcScopeMapping, identity: Pick<OidcIdentity, "groups" | "scopes">): OidcRole {
  const fallback = mapping.defaultRole ?? "member";
  for (const group of identity.groups ?? []) {
    const role = mapping.groups?.[group];
    if (role === "admin") return "admin";
  }
  for (const scope of identity.scopes ?? []) {
    const role = mapping.scopes?.[scope];
    if (role === "admin") return "admin";
  }
  for (const group of identity.groups ?? []) {
    if (mapping.groups?.[group] === "member") return fallback === "admin" ? "admin" : "member";
  }
  for (const scope of identity.scopes ?? []) {
    if (mapping.scopes?.[scope] === "member") return fallback === "admin" ? "admin" : "member";
  }
  return fallback;
}

/** Session scopes from the workspace role: admins get admin+client, members client. */
export function sessionScopesForRole(role: OidcRole): ["admin", "client"] | ["client"] {
  return role === "admin" ? ["admin", "client"] : ["client"];
}

interface OidcConfigRow {
  workspace_id: string;
  issuer: string;
  client_id: string;
  scope_mapping: string;
  enabled: number;
  updated_at: number;
}

function parseMapping(raw: string): OidcScopeMapping {
  try {
    const parsed = mappingSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

async function readConfig(env: AccountsEnv, workspace: string): Promise<OidcConfigRow | null> {
  return env.DB.prepare("SELECT * FROM workspace_oidc_configs WHERE workspace_id = ?").bind(workspace).first<OidcConfigRow>();
}

/** GET /api/auth/oidc/config?workspace=: admin reads the SSO config (never the client secret — it lives in env). */
export async function getOidcConfig(request: Request, env: AccountsEnv, auth: ControlPlaneAuth): Promise<Response> {
  const session = await requireAccount(request, auth);
  const workspace = new URL(request.url).searchParams.get("workspace") ?? "";
  if (!WORKSPACE_ID.test(workspace)) throw new HTTPError(400, "invalid_request");
  try {
    const member = await env.DB.prepare(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
    ).bind(workspace, session.user.id).first<{ role: string }>();
    if (!member) throw new HTTPError(404, "not_found");
    if (member.role !== "admin") throw new HTTPError(403, "forbidden");
    const row = await readConfig(env, workspace);
    if (!row) return contractJSON({ oidc: null });
    return contractJSON({
      oidc: { workspace, issuer: row.issuer, clientId: row.client_id, mapping: parseMapping(row.scope_mapping), enabled: row.enabled === 1 },
    });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw missingTable(error) ? new HTTPError(503, "workspaces_unavailable") : error;
  }
}

/** PUT /api/auth/oidc/config: admin registers/updates the issuer + scope mapping. */
export async function putOidcConfig(request: Request, env: AccountsEnv, auth: ControlPlaneAuth): Promise<Response> {
  const session = await requireAccount(request, auth);
  const parsed = configSchema.safeParse(await readBoundedJSON(request));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  const { workspace, issuer, clientId, mapping, enabled } = parsed.data;
  try {
    const member = await env.DB.prepare(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
    ).bind(workspace, session.user.id).first<{ role: string }>();
    if (!member) throw new HTTPError(404, "not_found");
    if (member.role !== "admin") throw new HTTPError(403, "forbidden");
    const workspaceRow = await env.DB.prepare("SELECT id FROM workspaces WHERE id = ?").bind(workspace).first();
    if (!workspaceRow) throw new HTTPError(404, "not_found");
    const stored = mapping === undefined ? JSON.stringify(parseMapping((await readConfig(env, workspace))?.scope_mapping ?? "{}")) : JSON.stringify(mapping);
    await env.DB.prepare(
      "INSERT INTO workspace_oidc_configs (workspace_id, issuer, client_id, scope_mapping, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET issuer = excluded.issuer, client_id = excluded.client_id, scope_mapping = excluded.scope_mapping, enabled = excluded.enabled, updated_at = excluded.updated_at",
    ).bind(workspace, issuer, clientId, stored, enabled === false ? 0 : 1, Date.now()).run();
    await audit(env, workspace, session.user.email, "sso.configured", { issuer });
    const row = await readConfig(env, workspace);
    return contractJSON({
      oidc: { workspace, issuer: row!.issuer, clientId: row!.client_id, mapping: parseMapping(row!.scope_mapping), enabled: row!.enabled === 1 },
    });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw missingTable(error) ? new HTTPError(503, "workspaces_unavailable") : error;
  }
}

export interface OidcExchange {
  fetchImpl?: typeof fetch;
  clientSecret?: string;
}

/**
 * POST /api/auth/oidc/callback: exchanges the authorization code at the
 * workspace issuer, maps scopes to a role, and upserts membership. The
 * client secret comes from env (`MAXIMUS_OIDC_CLIENT_SECRET`), never the
 * request. `fetchImpl` is injectable so tests never touch a live issuer.
 */
export async function oidcCallback(request: Request, env: AccountsEnv, auth: ControlPlaneAuth, exchange: OidcExchange = {}): Promise<Response> {
  const session = await requireAccount(request, auth);
  const parsed = callbackSchema.safeParse(await readBoundedJSON(request));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  const { workspace, code, redirectUri } = parsed.data;
  try {
    const row = await readConfig(env, workspace);
    if (!row || row.enabled !== 1) throw new HTTPError(409, "conflict");
    const secret = exchange.clientSecret ?? (env as unknown as Record<string, unknown>).MAXIMUS_OIDC_CLIENT_SECRET;
    if (typeof secret !== "string" || !secret) throw new HTTPError(503, "sso_unavailable");
    const fetchImpl = exchange.fetchImpl ?? fetch;
    const tokenResponse = await fetchImpl(`${row.issuer.replace(/\/$/, "")}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: row.client_id, client_secret: secret }),
    });
    if (!tokenResponse.ok) throw new HTTPError(401, "unauthorized");
    const tokenBody = await tokenResponse.json().catch(() => null) as { access_token?: unknown; id_token?: unknown } | null;
    if (typeof tokenBody?.access_token !== "string") throw new HTTPError(401, "unauthorized");
    const userinfoResponse = await fetchImpl(`${row.issuer.replace(/\/$/, "")}/userinfo`, {
      headers: { authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (!userinfoResponse.ok) throw new HTTPError(401, "unauthorized");
    const info = await userinfoResponse.json().catch(() => null) as {
      sub?: unknown; email?: unknown; email_verified?: unknown; groups?: unknown; scope?: unknown;
    } | null;
    if (typeof info?.sub !== "string" || typeof info?.email !== "string" || info.email_verified !== true) {
      throw new HTTPError(401, "unauthorized");
    }
    if ((info.email as string).toLowerCase() !== session.user.email.toLowerCase()) throw new HTTPError(403, "forbidden");
    const identity: OidcIdentity = {
      subject: info.sub,
      email: info.email,
      emailVerified: true,
      groups: Array.isArray(info.groups) ? info.groups.filter((g): g is string => typeof g === "string") : [],
      scopes: typeof info.scope === "string" ? info.scope.split(" ").filter(Boolean) : [],
    };
    const role = mapOidcScopes(parseMapping(row.scope_mapping), identity);
    const now = Date.now();
    const member = await env.DB.prepare(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
    ).bind(workspace, session.user.id).first<{ role: string }>();
    if (!member) {
      await env.DB.prepare(
        "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      ).bind(workspace, session.user.id, role, now).run();
    }
    await audit(env, workspace, session.user.email, "sso.signin", { role });
    return contractJSON({ sso: { workspace, role, scopes: sessionScopesForRole(role) } });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    throw missingTable(error) ? new HTTPError(503, "workspaces_unavailable") : error;
  }
}
