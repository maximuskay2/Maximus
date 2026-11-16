import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlMaximus } from "../scripts/control-maximus.ts";

type Control = {
  bot?: { id: string; threadId?: string };
  status?: string;
  messages?: Array<{ role: string; text?: string }>;
  ok?: boolean;
};

it("keeps one bot's thread across two sends on the isolated fixture", async () => {
  const fixture = await launchVerificationServer();
  const control = (...args: string[]) => runControlMaximus([...args, "--url", fixture.info.url]) as Promise<Control>;
  try {
    const created = await control("new-bot", "--name", "Kernel");
    const botId = created.bot?.id;
    expect(botId).toBeTruthy();
    await control("send", "--bot", botId!, "--text", "first");
    expect((await control("wait", "--bot", botId!, "--timeout", "30")).status).toBe("settled");
    await control("send", "--bot", botId!, "--text", "second");
    expect((await control("wait", "--bot", botId!, "--timeout", "30")).status).toBe("settled");
    const transcript = await control("messages", "--bot", botId!, "--limit", "20");
    expect(JSON.stringify(transcript)).toMatch(/first/);
    expect(JSON.stringify(transcript)).toMatch(/second/);
    const db = new DatabaseSync(join(fixture.info.dataDir, "messages.db"), { readOnly: true });
    try {
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally {
      db.close();
    }
  } finally {
    await fixture.close();
  }
}, 60_000);

it("continues the same workspace on Claude and Codex, MCP doctor, and a paired phone send", async () => {
  const fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, undefined, ["codex"]);
  const origin = fixture.info.url;
  const control = (...args: string[]) => runControlMaximus([...args, "--url", origin]) as Promise<Control>;
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
  try {
    expect(await control("doctor")).toMatchObject({ ok: true });

    const claude = await control("new-bot", "--name", "Claude Kernel");
    expect(claude.bot?.id).toBeTruthy();
    await control("send", "--bot", claude.bot!.id, "--text", "claude-turn");
    expect((await control("wait", "--bot", claude.bot!.id, "--timeout", "30")).status).toBe("settled");
    expect(JSON.stringify(await control("messages", "--bot", claude.bot!.id, "--limit", "20"))).toMatch(/claude-turn/);

    const codex = await control("new-bot", "--name", "Codex Kernel");
    expect(codex.bot?.id).toBeTruthy();
    await control("set-model", "--bot", codex.bot!.id, "--instance", "codex", "--model", "gpt-fake-default");
    await control("send", "--bot", codex.bot!.id, "--text", "codex-turn");
    expect((await control("wait", "--bot", codex.bot!.id, "--timeout", "45")).status).toBe("settled");
    expect(JSON.stringify(await control("messages", "--bot", codex.bot!.id, "--limit", "20"))).toMatch(/codex-turn/);

    const opened = await json("POST", "/api/auth/pairing", { scopes: ["client"], label: "V1 phone" });
    expect(opened.status).toBe(200);
    const paired = await json("POST", "/api/auth/pair", { code: (opened.body as { code: string }).code, label: "V1 phone" });
    expect(paired.status).toBe(200);
    const token = (paired.body as { token: string }).token;
    const sent = await json("POST", `/api/bots/${claude.bot!.id}/messages`, { text: "phone-send", threadId: claude.bot!.threadId }, token);
    expect([200, 201, 202]).toContain(sent.status);
    expect((await control("wait", "--bot", claude.bot!.id, "--timeout", "30")).status).toBe("settled");
    expect(JSON.stringify(await control("messages", "--bot", claude.bot!.id, "--limit", "30"))).toMatch(/phone-send/);
  } finally {
    await fixture.close();
  }
}, 120_000);
