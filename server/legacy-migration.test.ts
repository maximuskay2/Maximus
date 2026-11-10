// Anything touching the new dir before ensureDirs() runs would make the ~/.opengrokbot rename a no-op: this pins the order.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { workerPort } from "./testing/worker-port.ts";
import { copyDirVerified, importLegacyDataDir } from "./config.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const PORT = workerPort(18800, 10_000);
const WEBHOOK_PORT = workerPort(39000, 10_000);

let home: string;
let child: ChildProcess;
let stderr = "";

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "maximus-legacy-test-"));
  const legacy = join(home, ".opengrokbot");
  mkdirSync(legacy, { recursive: true });
  // A non-product shadow: an empty map would select the full default fleet, whose CLI probes are not part of this test.
  writeFileSync(join(legacy, "config.json"), JSON.stringify({
    instances: { fixture: { driver: "migration-test-shadow" } },
  }));
  writeFileSync(join(legacy, "keep-me.txt"), "carried over");
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      MAXIMUS_PORT: String(PORT),
      MAXIMUS_WEBHOOK_PORT: String(WEBHOOK_PORT),
      MAXIMUS_BROWSER_CONNECTION: join(home, "browser-test-connection.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.ok) return;
    } catch {
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start:\n${stderr}`);
}, 30_000);

afterAll(async () => {
  await waitForExit(child, { signal: "SIGTERM" });
  await removeTempDir(home);
});

describe("legacy data dir", () => {
  it("is renamed to the new name on first boot, with its contents and a fresh environment id", () => {
    const fresh = join(home, ".maximus");
    expect(existsSync(join(home, ".opengrokbot"))).toBe(false);
    expect(readFileSync(join(fresh, "keep-me.txt"), "utf8")).toBe("carried over");
    expect(readFileSync(join(fresh, "environment-id"), "utf8").trim()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("copyDirVerified", () => {
  it("copies nested contents and leaves the source intact", async () => {
    const root = mkdtempSync(join(tmpdir(), "maximus-copy-verify-"));
    try {
      const source = join(root, "src");
      mkdirSync(join(source, "events"), { recursive: true });
      writeFileSync(join(source, "config.json"), JSON.stringify({ ok: true }));
      writeFileSync(join(source, "events", "log.ndjson"), "{}\n");
      const target = join(root, "dst");
      expect(copyDirVerified(source, target)).toBe(true);
      expect(readFileSync(join(target, "config.json"), "utf8")).toBe(JSON.stringify({ ok: true }));
      expect(readFileSync(join(target, "events", "log.ndjson"), "utf8")).toBe("{}\n");
      expect(existsSync(join(source, "config.json"))).toBe(true);
    } finally {
      await removeTempDir(root);
    }
  });

  it("removes a partial copy it created when verification fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "maximus-copy-verify-"));
    try {
      const notDir = join(root, "file-not-dir");
      writeFileSync(notDir, "x");
      const target = join(root, "dst");
      expect(copyDirVerified(notDir, target)).toBe(false);
      expect(existsSync(target)).toBe(false);
    } finally {
      await removeTempDir(root);
    }
  });

  it("never removes a target it did not create", async () => {
    const root = mkdtempSync(join(tmpdir(), "maximus-copy-verify-"));
    try {
      const notDir = join(root, "file-not-dir");
      writeFileSync(notDir, "x");
      const target = join(root, "dst");
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, "precious.txt"), "keep");
      expect(copyDirVerified(notDir, target)).toBe(false);
      expect(readFileSync(join(target, "precious.txt"), "utf8")).toBe("keep");
    } finally {
      await removeTempDir(root);
    }
  });
});

describe("importLegacyDataDir", () => {
  it("copies the pre-rebrand dir first and leaves every source in place", async () => {
    const root = mkdtempSync(join(tmpdir(), "maximus-import-"));
    try {
      const target = join(root, ".maximus");
      const legacy = join(root, ".openmausbot");
      const ancient = join(root, ".opengrokbot");
      mkdirSync(legacy, { recursive: true });
      mkdirSync(ancient, { recursive: true });
      writeFileSync(join(legacy, "keep-me.txt"), "carried over");
      writeFileSync(join(ancient, "ancient.txt"), "stays");
      importLegacyDataDir(target, legacy, ancient);
      expect(readFileSync(join(target, "keep-me.txt"), "utf8")).toBe("carried over");
      expect(existsSync(join(target, "ancient.txt"))).toBe(false);
      expect(existsSync(join(legacy, "keep-me.txt"))).toBe(true);
      expect(existsSync(join(ancient, "ancient.txt"))).toBe(true);
    } finally {
      await removeTempDir(root);
    }
  });

  it("moves the ancient dir when no pre-rebrand dir exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "maximus-import-"));
    try {
      const target = join(root, ".maximus");
      const ancient = join(root, ".opengrokbot");
      mkdirSync(ancient, { recursive: true });
      writeFileSync(join(ancient, "keep-me.txt"), "carried over");
      importLegacyDataDir(target, join(root, ".openmausbot"), ancient);
      expect(readFileSync(join(target, "keep-me.txt"), "utf8")).toBe("carried over");
      expect(existsSync(ancient)).toBe(false);
    } finally {
      await removeTempDir(root);
    }
  });

  it("does nothing when the target already exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "maximus-import-"));
    try {
      const target = join(root, ".maximus");
      const legacy = join(root, ".openmausbot");
      mkdirSync(target, { recursive: true });
      mkdirSync(legacy, { recursive: true });
      writeFileSync(join(legacy, "keep-me.txt"), "stays out");
      importLegacyDataDir(target, legacy, join(root, ".opengrokbot"));
      expect(existsSync(join(target, "keep-me.txt"))).toBe(false);
    } finally {
      await removeTempDir(root);
    }
  });
});
