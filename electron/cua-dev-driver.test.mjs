import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ home: "", packaged: false }));
vi.mock("electron", () => ({
  app: {
    get isPackaged() { return fixture.packaged; },
    getPath: () => fixture.home,
    getAppPath: () => fixture.home,
  },
  ipcMain: { handle: vi.fn() },
}));
vi.mock("@trycua/cua-driver/embedded", () => ({ EmbeddedCuaDriverHost: class { start() { return { socketPath: "/fixture.sock" }; } stop() {} } }));
vi.mock("@trycua/cua-driver/electron", () => ({
  requestMacOSPermissions: () => ({ accessibility: true, screenRecording: true }),
  hasRequiredMacOSPermissions: () => true,
}));

let cua;
beforeEach(async () => {
  fixture.home = mkdtempSync(join(tmpdir(), "maximus-cua-dev-"));
  fixture.packaged = false;
  vi.stubEnv("CUA_DRIVER_PATH", "");
  vi.stubEnv("MAXIMUS_CUA_EMBEDDED", "");
  vi.stubEnv("MAXIMUS_CUA_DEV", "1");
  vi.resetModules();
  cua = await import("./cua.mjs");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(fixture.home, { recursive: true, force: true });
});

describe.skipIf(process.platform !== "darwin")("dev computer control", () => {
  it("uses the staged driver for this Mac and asks for permissions from the app", async () => {
    const driver = join(fixture.home, "dist-native", process.arch, "cua-driver");
    mkdirSync(join(fixture.home, "dist-native", process.arch), { recursive: true });
    writeFileSync(driver, "");
    expect(cua.resolveDriverBinary()).toBe(driver);
    await expect(cua.startCua()).resolves.toMatchObject({ mode: "embedded", mcpCommand: driver });
  });
});
