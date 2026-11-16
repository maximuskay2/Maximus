import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { AGENT_OS_STALE_MS } from "../shared/agent-os.ts";
import { launchVerificationServer, type VerificationServer } from "../scripts/control-maximus.ts";
import { removeTempDir } from "./testing/cleanup.ts";

let layerDir: string | undefined;
let fixture: VerificationServer | undefined;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
  if (layerDir) await removeTempDir(layerDir);
  layerDir = undefined;
});

it("from a paired phone, picks a lent Office Mac, only approves Canva, and waits if that Mac is asleep", async () => {
  layerDir = mkdtempSync(join(tmpdir(), "maximus-agent-os-layer-"));
  mkdirSync(join(layerDir, "server"));
  writeFileSync(join(layerDir, "server", "index.js"),
    `export function register() { return { customer: "Fixture Co", features: ["agentOsMachines"], expiresAt: null }; }\n`);
  fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, { dir: layerDir, licenseKey: "fixture-key" });
  const origin = fixture.info.url;
  const json = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };

  const opened = await json("POST", "/api/auth/pairing", { scopes: ["client"], label: "Ada phone" });
  expect(opened.status).toBe(200);
  const paired = await json("POST", "/api/auth/pair", { code: (opened.body as { code: string }).code, label: "Ada phone" });
  expect(paired.status).toBe(200);
  const token = (paired.body as { token: string }).token;

  const officeId = "11111111-1111-4111-8111-111111111111";
  writeFileSync(join(fixture.info.dataDir, "lent-computers.json"), JSON.stringify({
    version: 1,
    computers: [{
      id: officeId,
      person: "ada",
      name: "Office Mac",
      platform: "darwin",
      folders: 1,
      terminal: true,
      screen: true,
      chrome: true,
      lastSeenAt: Date.now(),
      lastUsedAt: null,
      stoppedAt: null,
    }],
  }));

  const listed = await json("GET", "/api/agent-os/machines", undefined, token);
  expect(listed.status).toBe(200);
  expect(((listed.body.machines as Array<{ id: string; online: boolean }>) ?? []).some((row) => row.id === officeId && row.online)).toBe(true);

  const created = await json("POST", "/api/bots", { name: "Ada" });
  expect(created.status).toBe(201);
  const bot = created.body.bot as { id: string; threadId: string; mainThreadId?: string };
  const threadId = bot.mainThreadId ?? bot.threadId;
  const botId = bot.id;

  const assigned = await json("PUT", "/api/agent-os/assignment", { machineId: officeId, threadId, botId }, token);
  expect(assigned.status).toBe(200);

  const routed = await json("POST", "/api/agent-os/route", { machineId: officeId, capability: "computer", threadId, botId }, token);
  expect(routed.status).toBe(200);
  expect(routed.body).toEqual(expect.objectContaining({
    ok: true,
    target: "remote",
    dispatch: "shared-computer",
    leasePath: `/api/shared-computers/${officeId}/lease`,
  }));

  const orphan = await json("POST", "/api/agent-os/heartbeat", {
    id: "orphan",
    name: "Orphan",
    kind: "lent_peer",
    capabilities: ["computer"],
  });
  expect(orphan.status).toBe(200);
  const refused = await json("POST", "/api/agent-os/route", { machineId: "orphan", capability: "computer", threadId, botId }, token);
  expect(refused.status).toBe(403);
  expect(String(refused.body.error)).toMatch(/live shared desktop/i);

  const canva = await json("POST", "/api/agent-os/plugins/invoke", {
    mode: "browser",
    app: "canva",
    action: "publish",
    confirm: true,
    threadId,
    botId,
  }, token);
  expect(canva.status).toBe(409);
  expect(String(canva.body.error)).toMatch(/only approve/i);

  const git = await json("POST", "/api/agent-os/plugins/invoke", {
    mode: "local",
    app: "git",
    action: "lookup",
    threadId,
    botId,
  }, token);
  expect(git.status).toBe(200);
  expect(git.body).toEqual(expect.objectContaining({ app: "git", executed: false, machineId: officeId }));

  writeFileSync(join(fixture.info.dataDir, "lent-computers.json"), JSON.stringify({
    version: 1,
    computers: [{
      id: officeId,
      person: "ada",
      name: "Office Mac",
      platform: "darwin",
      folders: 1,
      terminal: true,
      screen: true,
      chrome: true,
      lastSeenAt: Date.now() - AGENT_OS_STALE_MS - 1,
      lastUsedAt: null,
      stoppedAt: null,
    }],
  }));
  const asleep = await json("POST", "/api/agent-os/plugins/invoke", {
    mode: "browser",
    app: "canva",
    action: "publish",
    confirm: true,
    threadId,
    botId,
  }, token);
  expect(asleep.status).toBe(503);
  expect(asleep.body).toEqual(expect.objectContaining({
    wait: { machineId: officeId, name: "Office Mac" },
  }));
  expect(String(asleep.body.error)).toMatch(/asleep/i);

  const transcript = await json("GET", `/api/threads/${threadId}/messages?limit=50`, undefined, token);
  expect(transcript.status).toBe(200);
  const said = JSON.stringify(transcript.body);
  expect(said).toMatch(/only approve|git user|remote computer/i);
  expect(said).toMatch(/asleep/i);
}, 90_000);

it("from a paired phone, binds Office Mac and runs a leased shared-computer file action", async () => {
  layerDir = mkdtempSync(join(tmpdir(), "maximus-agent-os-dispatch-"));
  mkdirSync(join(layerDir, "server"));
  writeFileSync(join(layerDir, "server", "index.js"),
    `export function register() { return { customer: "Fixture Co", features: ["agentOsMachines"], expiresAt: null }; }\n`);
  fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "hang" }, undefined, undefined, undefined, { dir: layerDir, licenseKey: "fixture-key" });
  const origin = fixture.info.url;
  const json = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { "content-type": "application/json", origin, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };

  expect((await json("PATCH", "/api/config", { features: { sharedComputers: true } })).status).toBe(200);
  const env = await json("GET", "/.well-known/maximus/environment");
  expect(env.status).toBe(200);
  const environmentId = String((env.body as { environmentId: string }).environmentId);

  const opened = await json("POST", "/api/auth/pairing", { scopes: ["client"], label: "Ada phone" });
  expect(opened.status).toBe(200);
  const paired = await json("POST", "/api/auth/pair", { code: (opened.body as { code: string }).code, label: "Ada phone" });
  expect(paired.status).toBe(200);
  const token = (paired.body as { token: string }).token;
  const auth = { authorization: `Bearer ${token}` };

  const computerId = randomUUID();
  const folderId = randomUUID();
  const secret = randomBytes(32).toString("hex");

  expect((await json("POST", "/api/shared-computers/connect", {
    id: computerId,
    name: "Office Mac",
    environmentId,
    folders: [{ id: folderId, name: "Shared", write: false }],
    terminal: false,
    computer: true,
    platform: "darwin",
  }, { ...auth, "x-maximus-computer-secret": secret })).status).toBe(200);

  let leased = false;
  let stopPoll = false;
  const poller = (async () => {
    while (!stopPoll) {
      const polled = await json("POST", `/api/shared-computers/${computerId}/poll`, {}, {
        ...auth,
        "x-maximus-computer-secret": secret,
      });
      const job = (polled.body as { job?: { id: string; operation: { action: string; path?: string } } }).job;
      if (!job) continue;
      expect((await json("POST", `/api/shared-computers/${computerId}/lease`, { jobId: job.id }, {
        ...auth,
        "x-maximus-computer-secret": secret,
      })).status).toBe(200);
      leased = true;
      const result = job.operation.action === "list_files"
        ? { entries: [{ name: "brief.txt", type: "file" }] }
        : job.operation.action === "read_file"
          ? { content: "leased from Office Mac", encoding: "utf8" }
          : { ok: true };
      expect((await json("POST", `/api/shared-computers/${computerId}/result`, { jobId: job.id, result }, {
        ...auth,
        "x-maximus-computer-secret": secret,
      })).status).toBe(200);
    }
  })();

  try {
    const listed = await json("GET", "/api/agent-os/machines", undefined, auth);
    expect(listed.status).toBe(200);
    expect(((listed.body.machines as Array<{ id: string; online: boolean; kind: string }>) ?? [])
      .some((row) => row.id === computerId && row.online && row.kind === "lent_peer")).toBe(true);

    const created = await json("POST", "/api/bots", { name: "Ada" });
    expect(created.status).toBe(201);
    const bot = created.body.bot as { id: string; threadId: string; mainThreadId?: string };
    const threadId = bot.mainThreadId ?? bot.threadId;
    const botId = bot.id;

    expect((await json("PUT", "/api/agent-os/assignment", { machineId: computerId, threadId, botId }, auth)).status).toBe(200);
    const routed = await json("POST", "/api/agent-os/route", { machineId: computerId, capability: "computer", threadId, botId }, auth);
    expect(routed.status).toBe(200);
    expect(routed.body).toEqual(expect.objectContaining({
      ok: true,
      target: "remote",
      dispatch: "shared-computer",
      leasePath: `/api/shared-computers/${computerId}/lease`,
    }));

    expect((await json("POST", `/api/bots/${botId}/messages`, { text: "List the shared folder on Office Mac." }, auth)).status).toBe(202);

    const dump = join(fixture.info.dataDir, "fake-claude-dump.json");
    await expect.poll(() => {
      try { return Boolean(readFileSync(dump, "utf8")); } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);
    const agents = JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.agents;
    const { spawn } = await import("node:child_process");
    const { createInterface } = await import("node:readline");
    const proxy = spawn(agents.command, agents.args, {
      env: { PATH: process.env.PATH, HOME: fixture.info.dataDir, ...agents.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const waiting = new Map<number, (value: unknown) => void>();
    createInterface({ input: proxy.stdout! }).on("line", (line) => {
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    });
    let seq = 0;
    const rpc = (method: string, params?: unknown) => new Promise<any>((resolve, reject) => {
      const id = ++seq;
      const timeout = setTimeout(() => { waiting.delete(id); reject(new Error(`MCP ${method} timed out`)); }, 40_000);
      waiting.set(id, (value) => { clearTimeout(timeout); resolve(value); });
      proxy.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
    try {
      await rpc("initialize", { protocolVersion: "2024-11-05" });
      const listedShared = await rpc("tools/call", { name: "list_shared_computers", arguments: {} });
      const computers = JSON.parse(listedShared.result.content[0].text).computers as Array<{ id: string; folders: Array<{ id: string }> }>;
      expect(computers.some((row) => row.id === computerId)).toBe(true);
      const folder = computers.find((row) => row.id === computerId)!.folders[0]!.id;
      const listedFiles = await rpc("tools/call", {
        name: "shared_computer",
        arguments: { computer_id: computerId, folder_id: folder, action: "list_files" },
      });
      expect(listedFiles.result.isError).toBeFalsy();
      expect(JSON.parse(listedFiles.result.content[0].text).entries).toContainEqual({ name: "brief.txt", type: "file" });
      expect(leased).toBe(true);
    } finally {
      proxy.kill();
    }
  } finally {
    stopPoll = true;
    await poller.catch(() => {});
  }
}, 120_000);
