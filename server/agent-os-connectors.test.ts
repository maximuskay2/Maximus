import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { executePersonConnector, listPersonConnector } from "./agent-os-connectors.ts";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("listPersonConnector", () => {
  it("lists that person's Figma accounts from Composio", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "agent-os-connector-"));
    folders.push(dataDir);
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ composio: { apiKey: "ak_test", userId: "ada" } }));
    const fetchImpl = (async (input: string | URL) => {
      expect(String(input)).toMatch(/connected_accounts/);
      expect(String(input)).toMatch(/toolkit_slugs=figma/);
      return new Response(JSON.stringify({ items: [{ id: "ca_1", alias: "ada@figma", status: "ACTIVE" }] }), { status: 200 });
    }) as typeof fetch;
    await expect(listPersonConnector(dataDir, "figma", fetchImpl)).resolves.toEqual({
      connected: true,
      account: "ada@figma",
      items: [{ id: "ca_1", status: "ACTIVE", alias: "ada@figma" }],
    });
  });

  it("executes a Figma comment as that connected account", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "agent-os-connector-"));
    folders.push(dataDir);
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ composio: { apiKey: "ak_test", userId: "ada" } }));
    const seen: string[] = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("connected_accounts")) {
        return new Response(JSON.stringify({ items: [{ id: "ca_1", alias: "ada@figma", status: "ACTIVE" }] }), { status: 200 });
      }
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        tool_slug: "FIGMA_CREATE_COMMENT",
        user_id: "ada",
        connected_account_id: "ca_1",
        arguments: { file_key: "abc", message: "ship it" },
      });
      return new Response(JSON.stringify({ successful: true }), { status: 200 });
    }) as typeof fetch;
    await expect(executePersonConnector(dataDir, {
      slug: "figma",
      tool: "FIGMA_CREATE_COMMENT",
      arguments: { file_key: "abc", message: "ship it" },
    }, fetchImpl)).resolves.toMatchObject({ ok: true });
    expect(seen.some((url) => url.includes("/tools/execute"))).toBe(true);
  });

  it("stays disconnected when the person has not connected that app", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "agent-os-connector-"));
    folders.push(dataDir);
    expect(await listPersonConnector(dataDir, "figma")).toEqual({ connected: false });
  });
});
