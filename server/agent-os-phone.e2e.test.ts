import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

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

it("from a paired phone, picks Office Mac, only approves Canva, and waits if that Mac is asleep", async () => {
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

  expect((await json("POST", "/api/agent-os/heartbeat", {
    id: "office",
    name: "Office Mac",
    kind: "lent_peer",
    capabilities: ["computer", "browser"],
  })).status).toBe(200);

  const listed = await json("GET", "/api/agent-os/machines", undefined, token);
  expect(listed.status).toBe(200);
  expect(((listed.body.machines as Array<{ id: string; online: boolean }>) ?? []).some((row) => row.id === "office" && row.online)).toBe(true);

  const created = await json("POST", "/api/bots", { name: "Ada" });
  expect(created.status).toBe(201);
  const bot = created.body.bot as { id: string; threadId: string; mainThreadId?: string };
  const threadId = bot.mainThreadId ?? bot.threadId;
  const botId = bot.id;

  const assigned = await json("PUT", "/api/agent-os/assignment", { machineId: "office", threadId, botId }, token);
  expect(assigned.status).toBe(200);

  const routed = await json("POST", "/api/agent-os/route", { machineId: "office", capability: "computer", threadId, botId }, token);
  expect(routed.status).toBe(200);
  expect(routed.body).toEqual(expect.objectContaining({
    ok: true,
    target: "remote",
    dispatch: "shared-computer",
    leasePath: "/api/shared-computers/office/lease",
  }));

  const canva = await json("POST", "/api/agent-os/plugins/invoke", {
    mode: "browser",
    app: "canva",
    action: "publish",
    confirm: true,
    threadId,
    botId,
  }, token);
  expect(canva.status).toBe(200);
  expect(canva.body).toEqual(expect.objectContaining({ app: "canva", executed: false, bound: true, machineId: "office" }));
  expect(canva.body.cdpUrl).toBeUndefined();

  const git = await json("POST", "/api/agent-os/plugins/invoke", {
    mode: "local",
    app: "git",
    action: "lookup",
    threadId,
    botId,
  }, token);
  expect(git.status).toBe(200);
  expect(git.body).toEqual(expect.objectContaining({ app: "git", executed: false, machineId: "office" }));

  const machinesPath = join(fixture.info.dataDir, "agent-os-machines.json");
  const saved = JSON.parse(readFileSync(machinesPath, "utf8")) as { v: 1; machines: Array<{ id: string; lastSeenAt: number }> };
  writeFileSync(machinesPath, JSON.stringify({
    ...saved,
    machines: saved.machines.map((row) => row.id === "office" ? { ...row, lastSeenAt: 1 } : row),
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
    wait: { machineId: "office", name: "Office Mac" },
  }));
  expect(String(asleep.body.error)).toMatch(/asleep/i);

  const transcript = await json("GET", `/api/threads/${threadId}/messages?limit=50`, undefined, token);
  expect(transcript.status).toBe(200);
  const said = JSON.stringify(transcript.body);
  expect(said).toMatch(/Phone and hosted web only approve|only approve/i);
  expect(said).toMatch(/asleep/i);
}, 90_000);
