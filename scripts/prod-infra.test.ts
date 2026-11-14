// Production infra guards (Track 5): the compose overlays, hardened Caddyfile,
// backup sidecar, and Maximus release workflow keep the shape docs/prod-infra.md
// promises. Structural checks only — real signing and real deploys stay owner-gated.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

const prod = parse(read("deploy/compose.prod.yml")) as Record<string, any>;
const staging = parse(read("deploy/compose.staging.yml")) as Record<string, any>;
const base = parse(read("deploy/docker-compose.yml")) as Record<string, any>;
const caddyfile = read("deploy/Caddyfile.prod");
const backup = read("deploy/backup/backup.sh");
const release = parse(read(".github/workflows/maximus-release.yml")) as Record<string, any>;

describe("production compose overlays", () => {
  it("pin the release image from placeholders, never a hardcoded owner", () => {
    for (const overlay of [prod, staging]) {
      expect(overlay.services.maximus.image).toContain("ghcr.io/${RELEASE_OWNER");
      expect(overlay.services.maximus.image).not.toContain("Kayode-soni");
    }
    expect(prod.services.maximus.image).toContain("${MAXIMUS_VERSION");
    expect(staging.services.maximus.image).toContain("staging");
  });
  it("keep staging isolated from production", () => {
    expect(prod.name).toContain("prod");
    expect(staging.name).toContain("staging");
    expect(prod.name).not.toBe(staging.name);
    expect(staging.services.backup.environment.BACKUP_RETENTION_DAYS).not.toBe(
      prod.services.backup.environment.BACKUP_RETENTION_DAYS,
    );
  });
  it("cap resources and rotate logs on the app service", () => {
    expect(prod.services.maximus.deploy.resources.limits).toMatchObject({ cpus: expect.any(String), memory: expect.any(String) });
    expect(prod.services.maximus.logging.options).toMatchObject({ "max-size": expect.any(String), "max-file": expect.any(String) });
  });
  it("serve the hardened Caddyfile in both environments", () => {
    for (const overlay of [prod, staging]) {
      expect(JSON.stringify(overlay.services.caddy.volumes)).toContain("Caddyfile.prod");
    }
  });
  it("schedule volume backups that mount data read-only", () => {
    for (const overlay of [prod, staging]) {
      const backupService = overlay.services.backup;
      expect(backupService.environment.BACKUP_SCHEDULE).toMatch(/\d+ \d+ \* \* \*/);
      expect(JSON.stringify(backupService.volumes)).toContain("data:/data:ro");
      expect(JSON.stringify(backupService.volumes)).toContain("backups:/backups");
      expect(overlay.volumes).toHaveProperty("backups");
    }
  });
  it("keeps the base /api/health probe the overlays rely on", () => {
    expect(JSON.stringify(base.services.maximus.healthcheck)).toContain("/api/health");
  });
});

describe("hardened Caddyfile", () => {
  it("pins strict TLS and security headers", () => {
    expect(caddyfile).toContain("protocols tls1.2 tls1.3");
    expect(caddyfile).toContain("Strict-Transport-Security");
    expect(caddyfile).toContain("includeSubDomains; preload");
    expect(caddyfile).toContain("X-Content-Type-Options");
    expect(caddyfile).toContain("X-Frame-Options");
    expect(caddyfile).toContain("-Server");
  });
  it("passes health and webhooks through, streams the app", () => {
    expect(caddyfile).toContain("handle /api/health");
    expect(caddyfile).toContain("handle /hooks/*");
    expect(caddyfile).toContain("flush_interval -1");
  });
  it("serves only the configured domain", () => {
    expect(caddyfile).toContain("{$DOMAIN}");
    expect(caddyfile).not.toMatch(/maximus\.(com|si)/);
  });
});

describe("backup script", () => {
  it("snapshots, verifies, and prunes by retention", () => {
    expect(backup).toContain("tar -cpzf");
    expect(backup).toContain("tar -tzf");
    expect(backup).toContain("BACKUP_RETENTION_DAYS");
    expect(backup).toContain("-mtime");
    expect(backup).toContain("set -eu");
  });
});

describe("Maximus release workflow", () => {
  const stepsText = (job: string): string => JSON.stringify(release.jobs[job].steps);
  it("is tag- and dispatch-only, so a PR can never start a signed build", () => {
    expect(release.on.push.tags).toEqual(["maximus-v*"]);
    expect(release.on.pull_request).toBeUndefined();
    expect(release.jobs).toHaveProperty("gate");
    expect(release.jobs).toHaveProperty("mac");
    expect(release.jobs).toHaveProperty("win");
    expect(release.jobs).toHaveProperty("linux");
    expect(release.jobs).toHaveProperty("feed");
  });
  it("gates on typecheck, then lint, then the full test suite", () => {
    const gate = stepsText("gate");
    const typecheck = gate.indexOf("pnpm typecheck");
    const lint = gate.indexOf("oxlint --deny-warnings");
    const tests = gate.indexOf("pnpm test");
    expect(typecheck).toBeGreaterThanOrEqual(0);
    expect(lint).toBeGreaterThan(typecheck);
    expect(tests).toBeGreaterThan(lint);
  });
  it("builds every platform in parallel only after the gate", () => {
    for (const job of ["mac", "win", "linux"]) {
      expect(release.jobs[job].needs).toBe("gate");
    }
    expect(release.jobs.feed.needs).toEqual(expect.arrayContaining(["mac", "win", "linux"]));
  });
  it("signs from placeholder secrets and refuses to run without them", () => {
    const text = JSON.stringify(release.jobs);
    expect(text).toContain("secrets.MAXIMUS_MAC_CERT_P12_BASE64");
    expect(text).toContain("secrets.MAXIMUS_APPLE_API_KEY_P8_BASE64");
    expect(text).toContain("secrets.MAXIMUS_WIN_CERT_PFX_BASE64");
    expect(text).toContain("is not set");
    // Placeholder names only — no key material, no real hostnames.
    expect(text).not.toMatch(/-----BEGIN [A-Z ]+-----/);
    expect(text).not.toContain("Kayode-soni");
  });
  it("fails closed without both updater feeds", () => {
    expect(stepsText("feed")).toContain("latest-mac.yml");
    expect(stepsText("feed")).toContain("latest.yml");
  });
});

describe("infra docs and wrangler configs", () => {
  it("documents boot, restore, rotation, and the margin endpoint", () => {
    expect(read("docs/prod-infra.md")).toContain("Restore drill");
    expect(read("docs/secret-rotation.md")).toContain("MAXIMUS_LICENSE_PRIVATE_KEY");
    expect(read("docs/prod-infra.md")).toContain("/api/admin/usage/margin");
  });
  it("keeps both worker configs present for dry-run validation", () => {
    expect(existsSync(new URL("cloudflare/control-plane/wrangler.jsonc", root))).toBe(true);
    expect(existsSync(new URL("cloudflare/composio-broker/wrangler.jsonc", root))).toBe(true);
  });
});
