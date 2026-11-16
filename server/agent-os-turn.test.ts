import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AGENT_OS_STALE_MS } from "../shared/agent-os.ts";
import { createAgentOs, resetAgentOsHosts } from "./agent-os.ts";
import { callAgentOsBoundTool, gateAgentOsComputerTool } from "./agent-os-turn.ts";
import type { HarnessClient, Json } from "./drivers/agents-client.ts";

function lend(dataDir: string, id: string, at = 1_000) {
  writeFileSync(join(dataDir, "lent-computers.json"), JSON.stringify({
    version: 1,
    computers: [{
      id,
      person: "ada",
      name: "Office Mac",
      platform: "darwin",
      folders: 1,
      terminal: true,
      screen: true,
      chrome: true,
      lastSeenAt: at,
      lastUsedAt: null,
      stoppedAt: null,
    }],
  }));
}

const folders: string[] = [];
afterEach(() => {
  resetAgentOsHosts();
  delete process.env.MAXIMUS_DATA_DIR;
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

beforeEach(() => {
  resetAgentOsHosts();
});

function client(calls: Array<{ path: string; body?: string }>): HarnessClient {
  return {
    api: async (path, init) => {
      calls.push({ path, body: init?.body });
      if (path === "/api/internal/shared-computers" && init?.method === "POST") {
        return { result: { ran: true, args: JSON.parse(init.body ?? "{}") } };
      }
      return { computers: [{ id: "office", name: "Office Mac" }] };
    },
    apiResponse: async () => ({ ok: true, status: 200, body: {} }),
  };
}

describe("Agent OS turn dispatch", () => {
  it("fails in-thread when the bound computer is asleep", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "agent-os-turn-"));
    folders.push(dataDir);
    process.env.MAXIMUS_DATA_DIR = dataDir;
    const clock = { value: 1_000 };
    lend(dataDir, "office", clock.value);
    const os = createAgentOs({ dataDir, now: () => clock.value, entitled: () => true, self: { name: "Here", kind: "this_desktop" } });
    os.assign({ machineId: "office", threadId: "t1", botId: "b1" });
    clock.value += AGENT_OS_STALE_MS + 1;
    const calls: Array<{ path: string; body?: string }> = [];
    const result = await callAgentOsBoundTool("select_computer", {}, { botId: "b1", threadId: "t1", sharedComputers: true, client: client(calls) });
    expect(result).toMatchObject({ isError: true });
    expect(JSON.parse(result?.text ?? "{}")).toMatchObject({ wait: true, machineId: "office", name: "Office Mac" });
  });

  it("injects shared_computer lease id for a live remote machine", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "agent-os-turn-"));
    folders.push(dataDir);
    process.env.MAXIMUS_DATA_DIR = dataDir;
    lend(dataDir, "office");
    const os = createAgentOs({ dataDir, now: () => 1_000, entitled: () => true, self: { name: "Here", kind: "this_desktop" } });
    os.assign({ machineId: "office", threadId: "t1", botId: "b1" });
    const calls: Array<{ path: string; body?: string }> = [];
    const result = await callAgentOsBoundTool("shared_computer", { action: "list_files" } as Json, {
      botId: "b1",
      threadId: "t1",
      sharedComputers: true,
      client: client(calls),
    });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({ action: "list_files", computer_id: "office" });
    expect(result?.isError).toBeUndefined();
  });

  it("blocks local CUA when runsOn is a live remote Mac", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "agent-os-turn-gate-"));
    folders.push(dataDir);
    process.env.MAXIMUS_DATA_DIR = dataDir;
    lend(dataDir, "office");
    const os = createAgentOs({ dataDir, now: () => 1_000, entitled: () => true, self: { name: "Here", kind: "this_desktop" } });
    os.assign({ machineId: "office", threadId: "t1", botId: "b1" });
    const gated = gateAgentOsComputerTool("click", { botId: "b1", threadId: "t1", sharedComputers: true, client: client([]) });
    expect(gated).toMatchObject({ isError: true });
    expect(JSON.parse(gated?.text ?? "{}")).toMatchObject({
      runsOn: "office",
      dispatch: "shared-computer",
      leasePath: "/api/shared-computers/office/lease",
    });
  });

  it("invokes a confirmed Canva publish as a turn tool on this desktop", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "agent-os-turn-plugin-"));
    folders.push(dataDir);
    process.env.MAXIMUS_DATA_DIR = dataDir;
    createAgentOs({
      dataDir,
      now: () => 1_000,
      entitled: () => true,
      self: { name: "Office Mac", kind: "this_desktop" },
      attachNamedBrowser: async () => ({ cdpUrl: "ws://127.0.0.1:9/devtools/browser/x" }),
      clickPublish: async () => ({ ok: true, detail: "Clicked Publish in the signed-in browser." }),
    });
    const result = await callAgentOsBoundTool("agent_os", {
      mode: "browser",
      app: "canva",
      action: "publish",
      confirm: true,
    } as Json, { botId: "b1", threadId: "t1", sharedComputers: true, client: client([]) });
    expect(JSON.parse(result?.text ?? "{}")).toMatchObject({ app: "canva", executed: true, machineId: "self" });
  });
});
