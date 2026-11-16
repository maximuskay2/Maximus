import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AGENT_OS_STALE_MS } from "../shared/agent-os.ts";
import { createAgentOs } from "./agent-os.ts";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function spawnGit(cwd: string) {
  spawnSync("git", ["init"], { cwd, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "ada@git.test"], { cwd, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "Ada"], { cwd, encoding: "utf8" });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd, encoding: "utf8" });
  spawnSync("git", ["commit", "--allow-empty", "-m", "ready"], { cwd, encoding: "utf8" });
}

function lend(dataDir: string, id: string, name = "Office Mac", at = 1_000) {
  writeFileSync(join(dataDir, "lent-computers.json"), JSON.stringify({
    version: 1,
    computers: [{
      id,
      person: "ada",
      name,
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

function host(opts?: { entitled?: boolean; now?: { value: number }; lendId?: string }) {
  const dataDir = mkdtempSync(join(tmpdir(), "agent-os-"));
  folders.push(dataDir);
  if (opts?.lendId) lend(dataDir, opts.lendId, "Office Mac", opts.now?.value ?? 1_000);
  const clock = opts?.now ?? { value: 1_000 };
  return createAgentOs({
    dataDir,
    now: () => clock.value,
    entitled: () => opts?.entitled ?? false,
    self: { name: "Office Mac", kind: "this_desktop" },
  });
}

describe("Agent OS registry", () => {
  it("lists this computer as online, then grey when the heartbeat is stale", () => {
    const clock = { value: 1_000 };
    const os = host({ now: clock });
    const first = os.payload();
    expect(first.selfId).toBe("self");
    expect(first.machines).toEqual([expect.objectContaining({ id: "self", name: "Office Mac", kind: "this_desktop", online: true })]);
    clock.value += AGENT_OS_STALE_MS + 1;
    expect(os.payload().machines[0]?.online).toBe(false);
  });

  it("hides extra machines without a license and shows them when entitled", () => {
    const oss = host({ entitled: false });
    oss.heartbeat({ id: "till", name: "Till PC", kind: "lent_peer", capabilities: ["computer"] });
    expect(oss.payload().machines.map((row) => row.id)).toEqual(["self"]);
    const licensed = host({ entitled: true });
    licensed.heartbeat({ id: "till", name: "Till PC", kind: "lent_peer", capabilities: ["computer"] });
    expect(licensed.payload().machines.map((row) => row.id).sort()).toEqual(["self", "till"]);
  });
});

describe("Agent OS router", () => {
  it("refuses a silent run when the chosen computer is asleep", () => {
    const clock = { value: 1_000 };
    const os = host({ now: clock, entitled: true, lendId: "office" });
    clock.value += AGENT_OS_STALE_MS + 1;
    const result = os.route({ machineId: "office", capability: "computer", actor: "ada@example.test" });
    expect(result).toMatchObject({ ok: false, outcome: "offline" });
  });

  it("routes an approved local computer turn on this process", () => {
    const os = host({ entitled: false });
    const result = os.route({ machineId: "self", capability: "computer", actor: "ada@example.test" });
    expect(result).toEqual(expect.objectContaining({ ok: true, target: "local" }));
  });

  it("lets OSS use this computer without Your model", () => {
    const os = host({ entitled: false });
    const result = os.route({ machineId: "self", capability: "computer", actor: "ada" });
    expect(result).toMatchObject({ ok: true, target: "local" });
  });

  it("needs a paid plan to send a turn to another live computer", () => {
    const os = host({ entitled: false, lendId: "office" });
    expect(os.route({ machineId: "office", capability: "computer", actor: "ada" }).ok).toBe(false);
  });

  it("refuses a heartbeat-only peer that was never lent", () => {
    const os = host({ entitled: true });
    os.heartbeat({ id: "orphan", name: "Orphan", kind: "lent_peer", capabilities: ["computer"] });
    const result = os.route({ machineId: "orphan", capability: "computer", actor: "ada" });
    expect(result).toMatchObject({ ok: false, outcome: "denied" });
    expect(String(result.ok === false ? result.error : "")).toMatch(/live shared desktop/i);
  });

  it("routes to a live lent peer when entitled", () => {
    const os = host({ entitled: true, lendId: "office" });
    expect(os.route({ machineId: "office", capability: "computer", actor: "ada" })).toEqual(
      expect.objectContaining({ ok: true, target: "remote" }),
    );
  });
});

describe("Agent OS policy and audit", () => {
  it("blocks a bot the policy does not name, and records who last used a machine", () => {
    const os = host({ entitled: true });
    os.writePolicy({ bots: ["clerk"], machines: [], capabilities: ["computer", "browser", "connector"] });
    const denied = os.route({ machineId: "self", botId: "other", capability: "computer", actor: "ada" });
    expect(denied).toMatchObject({ ok: false, outcome: "denied" });
    os.route({ machineId: "self", botId: "clerk", capability: "computer", actor: "ada" });
    const rows = os.audit();
    expect(rows.at(-1)).toMatchObject({ actor: "ada", botId: "clerk", machineId: "self", outcome: "ok" });
    expect(rows.some((row) => row.botId === "other" && row.outcome === "denied")).toBe(true);
  });
});

describe("Agent OS plug-in modes", () => {
  it("proves API, browser, and local families as the same person, with a confirm on writes", async () => {
    const os = host({ entitled: true });
    const list = await os.invoke({ actor: "ada", personId: "ada", mode: "api", app: "figma", action: "list" });
    expect(list).toMatchObject({ ok: true, result: { as: "ada", app: "figma", account: "ada", bound: true } });
    expect(os.audit().at(-1)?.detail).toMatch(/person ada account ada machine self/);
    const comment = await os.invoke({ actor: "ada", personId: "ada", mode: "api", app: "figma", action: "comment" });
    expect(comment).toMatchObject({ ok: false, status: 409 });
    const publish = await os.invoke({ actor: "ada", personId: "ada", mode: "browser", app: "canva", action: "publish" });
    expect(publish).toMatchObject({ ok: false, status: 409 });
    const confirmed = await os.invoke({ actor: "ada", personId: "ada", mode: "browser", app: "canva", action: "publish", confirm: true });
    expect(confirmed).toMatchObject({ ok: false, status: 409 });
    expect(String(confirmed.ok === false ? confirmed.error : "")).toMatch(/Chromium partition|not running|only approve/i);
    const posted = await os.invoke({ actor: "ada", personId: "ada", mode: "local", app: "erp", action: "post", confirm: true });
    expect(posted).toMatchObject({ ok: false, status: 409 });
    expect(os.audit().at(-1)).toMatchObject({ outcome: "error" });
  });

  it("comments on Figma as that person after confirm", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "agent-os-figma-comment-"));
    folders.push(dataDir);
    const calls: Array<{ tool: string; arguments: Record<string, string> }> = [];
    const os = createAgentOs({
      dataDir,
      now: () => 1_000,
      entitled: () => true,
      self: { name: "Office Mac", kind: "this_desktop" },
      listPersonConnector: async () => ({ connected: true, account: "ada@figma", items: [{ id: "ca_1" }] }),
      executePersonConnector: async (input) => {
        calls.push({ tool: input.tool, arguments: input.arguments });
        return { ok: true, detail: `Called ${input.tool} as ada@figma.` };
      },
    });
    const commented = await os.invoke({
      actor: "ada",
      personId: "ada",
      mode: "api",
      app: "figma",
      action: "comment",
      confirm: true,
      args: { fileKey: "abc", comment: "ship it" },
    });
    expect(commented).toMatchObject({ ok: true, result: { executed: true, account: "ada@figma" } });
    expect(calls).toEqual([{ tool: "FIGMA_CREATE_COMMENT", arguments: { file_key: "abc", message: "ship it" } }]);
    expect(os.audit().at(-1)?.detail).toMatch(/person ada account ada@figma machine self/);
  });

  it("attaches Canva from this desktop's live Chromium port after confirm", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "agent-os-cdp-"));
    folders.push(dataDir);
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ browserProfiles: [{ id: "work", name: "Work", partitionId: "Work" }] }));
    const profile = join(dataDir, "agent-browser-profiles", createHash("sha256").update("Work").digest("hex").slice(0, 32));
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, "DevToolsActivePort"), "9222\n/devtools/browser/fixture\n");
    const clicks: string[] = [];
    const os = createAgentOs({
      dataDir,
      now: () => 1_000,
      entitled: () => true,
      self: { name: "Office Mac", kind: "this_desktop" },
      clickPublish: async (cdpUrl) => {
        clicks.push(cdpUrl);
        return { ok: true, detail: "Clicked Publish in the signed-in browser." };
      },
    });
    const published = await os.invoke({ actor: "ada", personId: "ada", mode: "browser", app: "canva", action: "publish", confirm: true });
    expect(published).toMatchObject({
      ok: true,
      result: { executed: true, cdpUrl: "ws://127.0.0.1:9222/devtools/browser/fixture" },
    });
    expect(clicks).toEqual(["ws://127.0.0.1:9222/devtools/browser/fixture"]);
  });

  it("attaches Canva Chromium on this desktop after confirm, and never from a phone", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "agent-os-canva-"));
    folders.push(dataDir);
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ browserProfiles: [{ id: "work", name: "Work", partitionId: "Work" }] }));
    const os = createAgentOs({
      dataDir,
      now: () => 1_000,
      entitled: () => true,
      self: { name: "Office Mac", kind: "this_desktop" },
      attachNamedBrowser: async (partition) => ({ cdpUrl: partition === "Work" ? "ws://127.0.0.1:9/devtools/browser/x" : undefined }),
      clickPublish: async () => ({ ok: true, detail: "Clicked Publish in the signed-in browser." }),
    });
    const desktop = await os.invoke({ actor: "ada", personId: "ada", mode: "browser", app: "canva", action: "publish", confirm: true, client: "desktop" });
    expect(desktop).toMatchObject({ ok: true, result: { executed: true, cdpUrl: "ws://127.0.0.1:9/devtools/browser/x" } });
    const phone = await os.invoke({ actor: "ada", personId: "ada", mode: "browser", app: "canva", action: "publish", confirm: true, client: "remote" });
    expect(phone).toMatchObject({ ok: false, status: 409 });
    expect(String(phone.ok === false ? phone.error : "")).toMatch(/only approve/i);
    expect(os.audit().at(-1)).toMatchObject({ outcome: "error" });
  });

  it("lists Figma as that person's connected account", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "agent-os-figma-"));
    folders.push(dataDir);
    const os = createAgentOs({
      dataDir,
      now: () => 1_000,
      entitled: () => true,
      self: { name: "Office Mac", kind: "this_desktop" },
      listPersonConnector: async () => ({ connected: true, account: "ada@figma", items: [{ id: "file-1" }] }),
    });
    const list = await os.invoke({ actor: "ada", personId: "ada", mode: "api", app: "figma", action: "list" });
    expect(list).toMatchObject({
      ok: true,
      result: { app: "figma", account: "ada@figma", executed: true, items: [{ id: "file-1" }], bound: true },
    });
    expect(os.audit().at(-1)?.detail).toMatch(/person ada account ada@figma machine self/);
  });

  it("assembles a PR as that git user without contacting origin", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "agent-os-git-"));
    const repo = mkdtempSync(join(tmpdir(), "agent-os-repo-"));
    folders.push(dataDir, repo);
    spawnGit(repo);
    const previous = process.env.MAXIMUS_WORKSPACE;
    process.env.MAXIMUS_WORKSPACE = repo;
    try {
      const os = createAgentOs({ dataDir, now: () => 1_000, entitled: () => true, self: { name: "Office Mac", kind: "this_desktop" } });
      const posted = await os.invoke({ actor: "ada", personId: "ada", mode: "local", app: "git", action: "post", confirm: true });
      expect(posted).toMatchObject({ ok: true, result: { executed: true, account: "ada@git.test" } });
      if (posted.ok) expect(String(posted.result.detail)).toMatch(/Origin is not contacted/);
    } finally {
      if (previous === undefined) delete process.env.MAXIMUS_WORKSPACE;
      else process.env.MAXIMUS_WORKSPACE = previous;
    }
  });

  it("looks up git on this computer as Mode C", async () => {
    const os = host({ entitled: true });
    const lookup = await os.invoke({ actor: "ada", personId: "ada", mode: "local", app: "git", action: "lookup" });
    expect(lookup).toMatchObject({ ok: true, result: { app: "git", executed: true, as: "ada", machineId: "self" } });
  });

  it("does not run git in this process for a live remote computer", async () => {
    const os = host({ entitled: true, lendId: "office" });
    os.assign({ machineId: "office", botId: "clerk" });
    const live = await os.invoke({ actor: "ada", personId: "ada", mode: "local", app: "git", action: "lookup", botId: "clerk" });
    expect(live).toMatchObject({ ok: true, result: { machineId: "office", executed: false } });
    expect(os.audit().at(-1)).toMatchObject({ machineId: "office", outcome: "error" });
  });

  it("uses the bound machine and waits when that computer is asleep", async () => {
    const clock = { value: 1_000 };
    const os = host({ now: clock, entitled: true, lendId: "office" });
    os.assign({ machineId: "office", botId: "clerk" });
    clock.value += AGENT_OS_STALE_MS + 1;
    const asleep = await os.invoke({ actor: "ada", personId: "ada", mode: "local", app: "git", action: "lookup", botId: "clerk" });
    expect(asleep).toMatchObject({ ok: false, status: 503, wait: { machineId: "office", name: "Office Mac" } });
  });
});

describe("Agent OS overlay", () => {
  it("lists a live lent desktop and a team boat from existing files", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "agent-os-overlay-"));
    folders.push(dataDir);
    writeFileSync(join(dataDir, "lent-computers.json"), JSON.stringify({
      version: 1,
      computers: [{
        id: "11111111-1111-4111-8111-111111111111",
        person: "ada",
        name: "Office Mac",
        platform: "darwin",
        folders: 0,
        terminal: true,
        screen: true,
        chrome: true,
        lastSeenAt: 1_000,
        lastUsedAt: null,
        stoppedAt: null,
      }],
    }));
    writeFileSync(join(dataDir, "team-computers.json"), JSON.stringify({
      version: 1,
      environmentId: "22222222-2222-4222-8222-222222222222",
      computers: [{ id: "33333333-3333-4333-8333-333333333333", name: "Team boat", section: null, createdAt: 1_000 }],
    }));
    const os = createAgentOs({ dataDir, now: () => 1_000, entitled: () => true, self: { name: "Here", kind: "this_desktop" } });
    expect(os.payload().machines.map((row) => row.id).sort()).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "33333333-3333-4333-8333-333333333333",
      "self",
    ]);
    expect(os.find("11111111-1111-4111-8111-111111111111")).toMatchObject({ online: true, kind: "lent_peer" });
    expect(os.find("33333333-3333-4333-8333-333333333333")).toMatchObject({ online: false, kind: "team_boat" });
  });
});
