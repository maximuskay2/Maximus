// OIDC SSO scope mapping, server side (greenfield — upstream has none).
// Mirrors the control plane's mapping semantics (cloudflare/control-plane/
// src/sso.ts): the workspace's OIDC config maps identity scopes/groups to a
// role, and the role derives session scopes. Everything here sits behind the
// `sso` entitlement: without it, SSO sign-in is refused outright.
import { entitled } from "./enterprise.ts";
import type { Scope } from "./sessions.ts";

export type OidcRole = "admin" | "member";

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

export const SSO_DISABLED_ERROR = "Single sign-on needs an enterprise licence with the sso feature.";

/** The `sso` entitlement gates every SSO path on this server. */
export function ssoEnabled(now = Date.now()): boolean {
  return entitled("sso", now);
}

/** First admin match wins; otherwise the default role (member). Unknown scopes grant nothing. */
export function mapOidcScopesToRole(mapping: OidcScopeMapping, identity: Pick<OidcIdentity, "groups" | "scopes">): OidcRole {
  const fallback = mapping.defaultRole ?? "member";
  for (const group of identity.groups ?? []) {
    if (mapping.groups?.[group] === "admin") return "admin";
  }
  for (const scope of identity.scopes ?? []) {
    if (mapping.scopes?.[scope] === "admin") return "admin";
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
export function ssoSessionScopes(role: OidcRole): Scope[] {
  return role === "admin" ? ["admin", "client"] : ["client"];
}

/** Refusal for an SSO sign-in attempt, or null when it may proceed. */
export function ssoSignInRefusal(identity: OidcIdentity, now = Date.now()): string | null {
  if (!ssoEnabled(now)) return SSO_DISABLED_ERROR;
  if (!identity.emailVerified) return "Single sign-on requires a verified email address.";
  if (!identity.email || !identity.subject) return "Single sign-on did not return an identity.";
  return null;
}
