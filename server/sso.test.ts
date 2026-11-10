// SSO scope mapping: gate, mapping matrix, identity refusal.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadEnterpriseLayer } from "./enterprise.ts";
import { mapOidcScopesToRole, ssoEnabled, ssoSessionScopes, ssoSignInRefusal } from "./sso.ts";

const dirs: string[] = [];

/** A stand-in enterprise layer: the folder shape core looks for, with the given register(). */
function fakeLayer(registerSource: string): string {
  const dir = mkdtempSync(join(tmpdir(), "maximus-sso-"));
  mkdirSync(join(dir, "server"));
  writeFileSync(join(dir, "server", "index.js"), registerSource);
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await loadEnterpriseLayer({ dir: join(tmpdir(), "maximus-enterprise-absent"), licenseKey: undefined });
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("sso gate", () => {
  it("is off without the sso entitlement and on with it", async () => {
    expect(ssoEnabled()).toBe(false);
    expect(ssoSignInRefusal({ subject: "u", email: "a@example.test", emailVerified: true })).toContain("sso feature");
    const dir = fakeLayer(`export async function register() { return { customer: "SSO Co", features: ["sso"], expiresAt: null }; }`);
    await loadEnterpriseLayer({ dir, licenseKey: "max1.fixture" });
    expect(ssoEnabled()).toBe(true);
    expect(ssoSignInRefusal({ subject: "u", email: "a@example.test", emailVerified: true })).toBeNull();
  });

  it("refuses unverified or empty identities", async () => {
    const dir = fakeLayer(`export async function register() { return { customer: "SSO Co", features: ["sso"], expiresAt: null }; }`);
    await loadEnterpriseLayer({ dir, licenseKey: "max1.fixture" });
    expect(ssoSignInRefusal({ subject: "u", email: "a@example.test", emailVerified: false })).toContain("verified");
    expect(ssoSignInRefusal({ subject: "", email: "", emailVerified: true })).toContain("identity");
  });
});

describe("oidc scope mapping", () => {
  it("maps admin groups/scopes first and defaults to member", () => {
    const mapping = { groups: { "maximus-admins": "admin" as const }, scopes: { admin: "admin" as const }, defaultRole: "member" as const };
    expect(mapOidcScopesToRole(mapping, { groups: ["maximus-admins"], scopes: [] })).toBe("admin");
    expect(mapOidcScopesToRole(mapping, { groups: [], scopes: ["admin"] })).toBe("admin");
    expect(mapOidcScopesToRole(mapping, { groups: ["everyone"], scopes: ["openid"] })).toBe("member");
    expect(mapOidcScopesToRole({}, { groups: [], scopes: [] })).toBe("member");
    expect(mapOidcScopesToRole({ defaultRole: "admin" }, { groups: [], scopes: [] })).toBe("admin");
    expect(mapOidcScopesToRole({ groups: { team: "member" } }, { groups: ["team"], scopes: [] })).toBe("member");
  });

  it("derives session scopes from the role", () => {
    expect(ssoSessionScopes("admin")).toEqual(["admin", "client"]);
    expect(ssoSessionScopes("member")).toEqual(["client"]);
  });
});
