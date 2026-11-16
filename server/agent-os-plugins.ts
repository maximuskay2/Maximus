import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentOsMachine, AgentOsPluginMode } from "../shared/agent-os.ts";
import {
  executePersonConnector,
  listPersonConnector,
  type PersonConnectorAccount,
} from "./agent-os-connectors.ts";

export type AgentOsClient = "desktop" | "remote";

export interface PluginResult {
  ok: boolean;
  preview?: string;
  detail?: string;
  account?: string;
  items?: Array<{ id: string; status?: string; alias?: string }>;
  cdpUrl?: string;
}

export interface ExecutePluginInput {
  mode: AgentOsPluginMode;
  app: string;
  action: string;
  personId: string;
  dataDir: string;
  confirmed?: boolean;
  target: "local" | "remote";
  machine: AgentOsMachine;
  client: AgentOsClient;
  args?: Record<string, string>;
  listPersonConnector?: (slug: string) => Promise<PersonConnectorAccount>;
  executePersonConnector?: (input: { slug: string; tool: string; arguments: Record<string, string> }) => Promise<{ ok: boolean; detail?: string }>;
  attachNamedBrowser?: (partition: string) => Promise<{ cdpUrl?: string }>;
  clickPublish?: (cdpUrl: string) => Promise<{ ok: boolean; detail?: string }>;
}

function browserProfile(dataDir: string): { name: string; session: string } {
  try {
    const cfg = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")) as {
      browserProfiles?: Array<{ id?: string; name?: string; partitionId?: string }>;
    };
    const profile = cfg.browserProfiles?.[0];
    const session = profile?.partitionId?.trim() || profile?.id?.trim() || "signed-in";
    return { name: profile?.name?.trim() || "signed-in browser", session };
  } catch {
    return { name: "signed-in browser", session: "signed-in" };
  }
}

function gitCwd(): string {
  return process.env.MAXIMUS_WORKSPACE || process.cwd();
}

function git(args: string[], cwd: string): string {
  const run = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 5_000 });
  return (run.stdout || run.stderr || "").trim();
}

export async function clickPublishInChromium(cdpUrl: string): Promise<{ ok: boolean; detail?: string }> {
  if (!/^wss?:\/\//i.test(cdpUrl)) {
    return { ok: false, detail: "Chromium DevTools did not publish a WebSocket. Open Maximus on that desktop." };
  }
  return await new Promise((resolve) => {
    let settled = false;
    const done = (result: { ok: boolean; detail?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      resolve(result);
    };
    const timer = setTimeout(() => done({ ok: false, detail: "Publish click timed out." }), 1_500);
    const socket = new WebSocket(cdpUrl);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression: `(() => { const n = document.querySelector('[data-maximus-publish], [aria-label="Publish"]'); if (!n) return false; n.click(); return true; })()`,
          returnByValue: true,
        },
      }));
    });
    socket.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(String((event as MessageEvent).data)) as { id?: number; result?: { result?: { value?: boolean } } };
        if (msg.id !== 1) return;
        done(msg.result?.result?.value === true
          ? { ok: true, detail: "Clicked Publish in the signed-in browser. Canva.com was not opened from Maximus." }
          : { ok: false, detail: "No Publish control on the open page." });
      } catch {
        done({ ok: false, detail: "Chromium DevTools returned an unreadable click result." });
      }
    });
    socket.addEventListener("error", () => done({ ok: false, detail: "Chromium DevTools did not accept the click." }));
  });
}

export async function attachNamedChromium(dataDir: string, session: string): Promise<{ cdpUrl?: string }> {
  if (!/^[A-Za-z0-9_.-]{1,96}$/.test(session)) return {};
  const profile = join(dataDir, "agent-browser-profiles", createHash("sha256").update(session).digest("hex").slice(0, 32));
  try {
    const [portLine, pathLine] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n");
    const port = Number(portLine?.trim());
    if (!Number.isInteger(port) || port <= 0 || port >= 65_536) return {};
    const path = pathLine?.trim();
    return { cdpUrl: path?.startsWith("/") ? `ws://127.0.0.1:${port}${path}` : `http://127.0.0.1:${port}` };
  } catch {
    return {};
  }
}

function figmaTool(action: string): string {
  if (action === "comment") return "FIGMA_CREATE_COMMENT";
  if (action === "lookup") return "FIGMA_GET_FILE_JSON";
  return "FIGMA_GET_FILE_JSON";
}

export async function executeAgentOsPlugin(input: ExecutePluginInput): Promise<PluginResult> {
  const preview = `${input.app} ${input.action} as ${input.personId}`;
  if (input.mode === "api") {
    const listed = await (input.listPersonConnector ?? ((slug: string) => listPersonConnector(input.dataDir, slug)))(input.app);
    const account = listed.account ?? input.personId;
    if (!listed.connected) {
      return {
        ok: false,
        account,
        items: listed.items,
        preview,
        detail: "Connect that app as yourself in Apps. Maximus will use your account, not a shared login.",
      };
    }
    const fileKey = input.args?.fileKey?.trim();
    const comment = input.args?.comment?.trim();
    const shouldCall = input.action === "comment" || Boolean(fileKey);
    if (!shouldCall) {
      return {
        ok: true,
        account,
        items: listed.items,
        preview,
        detail: `Uses ${account}'s ${input.app} account. Chat tools list and comment as that person.`,
      };
    }
    const tool = figmaTool(input.action);
    const executed = await (input.executePersonConnector ?? ((call) => executePersonConnector(input.dataDir, call)))({
      slug: input.app,
      tool,
      arguments: {
        ...(fileKey ? { file_key: fileKey } : {}),
        ...(comment ? { message: comment } : {}),
      },
    });
    return {
      ok: executed.ok,
      account,
      items: listed.items,
      preview,
      detail: executed.detail ?? `Called ${tool} as ${account}.`,
    };
  }

  if (input.mode === "browser") {
    const profile = browserProfile(input.dataDir);
    const onThisDesktop = input.target === "local" && input.client === "desktop";
    if (input.action !== "publish") {
      return {
        ok: true,
        preview,
        detail: `Chromium partition "${profile.name}" on ${input.machine.name}. Phone and hosted web only approve.`,
      };
    }
    if (!onThisDesktop) {
      return {
        ok: false,
        preview,
        detail: `Phone and hosted web only approve. Chromium partition "${profile.name}" on ${input.machine.name}.`,
      };
    }
    const attached = await (input.attachNamedBrowser ?? ((partition) => attachNamedChromium(input.dataDir, partition)))(profile.session);
    if (!attached.cdpUrl) {
      return {
        ok: false,
        preview,
        detail: `Chromium partition "${profile.name}" on ${input.machine.name} is not running. Open Maximus on that desktop.`,
      };
    }
    const clicked = await (input.clickPublish ?? clickPublishInChromium)(attached.cdpUrl);
    return {
      ok: clicked.ok,
      preview,
      detail: clicked.detail ?? `Attached Chromium partition "${profile.name}" on ${input.machine.name}.`,
      cdpUrl: attached.cdpUrl,
    };
  }

  if (input.app === "git") {
    if (input.target !== "local") {
      return { ok: false, preview, detail: `Runs on ${input.machine.name} as that git user. This process does not run git for a remote computer.` };
    }
    const cwd = gitCwd();
    if (spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8", timeout: 5_000 }).status !== 0) {
      return { ok: false, detail: "This folder is not a git repository." };
    }
    const account = git(["config", "user.email"], cwd);
    if (input.action === "lookup") {
      const status = git(["status", "--porcelain=v1", "-b"], cwd);
      return { ok: true, account, preview: "git status", detail: status.slice(0, 4_000) || "(clean)" };
    }
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    const title = git(["log", "-1", "--format=%s"], cwd);
    const head = git(["rev-parse", "HEAD"], cwd);
    return {
      ok: true,
      account,
      preview: "git pull-request",
      detail: `PR as ${account || input.personId} on ${branch}: ${title}. Origin is not contacted.`,
      items: [{ id: head || branch, alias: title, status: branch }],
    };
  }

  return { ok: false, preview };
}
