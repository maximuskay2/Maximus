import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { classifyDownload, createDownloadsRoute, listDownloads } from "./downloads.ts";

function setup(files: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "maximus-downloads-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  const calls: { status: number; body: unknown }[] = [];
  const heads: { status: number; headers: Record<string, unknown> }[] = [];
  let ended = 0;
  const res = {
    setHeader: () => undefined,
    writeHead: (status: number, headers: Record<string, unknown>) => { heads.push({ status, headers }); },
    end: () => { ended += 1; },
    once: () => undefined,
    destroy: () => undefined,
  } as unknown as ServerResponse;
  const json = (_res: ServerResponse, status: number, body: unknown): void => {
    calls.push({ status, body });
  };
  const req = { url: "/", headers: {} } as IncomingMessage;
  return { dir, req, res, calls, json, heads, ended: () => ended };
}

describe("installer downloads", () => {
  it("classifies user-facing builds and skips update zips", () => {
    expect(classifyDownload("Maximus-0.1.144-arm64.dmg")).toEqual({ os: "mac", arch: "arm64", kind: "image" });
    expect(classifyDownload("Maximus-0.1.144-x64.dmg")).toEqual({ os: "mac", arch: "x64", kind: "image" });
    expect(classifyDownload("Maximus-0.1.144-setup.exe")).toEqual({ os: "windows", arch: "x64", kind: "installer" });
    expect(classifyDownload("Maximus-0.1.144-x64.AppImage")).toEqual({ os: "linux", arch: "x64", kind: "installer" });
    expect(classifyDownload("Maximus-0.1.144-x86_64.AppImage")).toEqual({ os: "linux", arch: "x64", kind: "installer" });
    expect(classifyDownload("Maximus-0.1.144-amd64.deb")).toEqual({ os: "linux", arch: "x64", kind: "package" });
    expect(classifyDownload("maximus_0.1.144_amd64.deb")).toEqual({ os: "linux", arch: "amd64", kind: "package" });
    expect(classifyDownload("Maximus-0.1.144-arm64.zip")).toBeNull();
    expect(classifyDownload("latest.yml")).toBeNull();
    expect(classifyDownload("Maximus-0.1.144-x64.exe")).toBeNull();
  });

  it("lists only builds that exist, with sizes", async () => {
    const { dir } = setup({
      "Maximus-0.1.144-arm64.dmg": "dmg-bytes",
      "Maximus-0.1.144-setup.exe": "exe-bytes!",
      "latest.yml": "nope",
    });
    expect(await listDownloads(dir)).toEqual([
      { os: "mac", arch: "arm64", kind: "image", file: "Maximus-0.1.144-arm64.dmg", bytes: 9 },
      { os: "windows", arch: "x64", kind: "installer", file: "Maximus-0.1.144-setup.exe", bytes: 10 },
    ]);
    expect(await listDownloads(join(dir, "missing"))).toEqual([]);
  });

  it("serves the manifest and refuses traversal names", async () => {
    const { dir, req, res, calls, json, heads, ended } = setup({ "Maximus-0.1.144-arm64.dmg": "dmg-bytes" });
    const route = createDownloadsRoute({ releaseDir: dir, version: "0.1.144" });
    expect(await route(req, res, "/api/other", "GET", json)).toBe(false);
    expect(await route(req, res, "/api/downloads", "GET", json)).toBe(true);
    expect(calls[0]?.status).toBe(200);
    expect(calls[0]?.body).toEqual({
      version: "0.1.144",
      files: [{ os: "mac", arch: "arm64", kind: "image", file: "Maximus-0.1.144-arm64.dmg", bytes: 9 }],
    });
    expect(await route(req, res, "/api/downloads/file/..%2Fsecret", "GET", json)).toBe(true);
    expect(calls[1]?.status).toBe(404);
    expect(await route(req, res, "/api/downloads/file/latest.yml", "GET", json)).toBe(true);
    expect(calls[2]?.status).toBe(404);
    expect(await route(req, res, "/api/downloads/file/Maximus-0.1.144-x64.dmg", "GET", json)).toBe(true);
    expect(calls[3]?.status).toBe(404);
    expect(await route(req, res, "/api/downloads/file/Maximus-0.1.144-arm64.dmg", "HEAD", json)).toBe(true);
    expect(heads[0]).toMatchObject({ status: 200, headers: { "content-length": 9 } });
    expect(heads[0]?.headers["content-disposition"]).toContain("Maximus-0.1.144-arm64.dmg");
    expect(ended()).toBe(1);
  });
});
