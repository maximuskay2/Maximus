import { describe, expect, it, vi } from "vitest";

import { keyEntry } from "../components/keys/key-catalog";
import { keySavedState } from "./AdminHarness";
import {
  HarnessError,
  harnessBots,
  harnessConfig,
  harnessSendMessage,
  harnessSessions,
  harnessUsage,
  revokeHarnessSession,
  saveHarnessConfig,
  toHarnessActivity,
  toHarnessHealth,
  toHarnessBots,
  toHarnessMessages,
  toHarnessPairings,
  toHarnessSession,
  toHarnessSessions,
  toSignInLists,
  toUsageGroups,
} from "./harness";

function stubFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
}

describe("harness session view", () => {
  it("trusts only loopback-owner and admin sessions", () => {
    expect(toHarnessSession({ kind: "loopback", scopes: ["admin", "client"] })).toEqual({ kind: "loopback", admin: true, email: "", label: "" });
    expect(toHarnessSession({ kind: "loopback", trust: "service" })).toMatchObject({ kind: "none", admin: false });
    expect(toHarnessSession({ kind: "session", id: "s1", label: "Laptop", email: "a@b.co", scopes: ["admin", "client"] }))
      .toEqual({ kind: "session", admin: true, email: "a@b.co", label: "Laptop" });
    expect(toHarnessSession({ kind: "session", id: "s2", scopes: ["client"] })).toMatchObject({ kind: "session", admin: false });
    expect(toHarnessSession({ kind: "session" })).toMatchObject({ kind: "none" });
    expect(toHarnessSession(null)).toMatchObject({ kind: "none", admin: false });
  });
});

describe("harness normalizers", () => {
  it("reads sign-in lists, sessions, and pairings, dropping malformed rows", () => {
    expect(toSignInLists({ signIn: { admins: ["a@b.co"], members: ["c@d.co", 7] } })).toEqual({ admins: ["a@b.co"], members: ["c@d.co"] });
    expect(toSignInLists(null)).toEqual({ admins: [], members: [] });
    expect(toHarnessSessions({ current: "s1", sessions: [{ id: "s1", label: "Laptop", email: "a@b.co", scopes: ["admin"], expiresAt: 9 }, null] }))
      .toEqual([{ id: "s1", label: "Laptop", email: "a@b.co", scopes: ["admin"], expiresAt: 9, current: true }]);
    expect(toHarnessPairings({ pairings: [{ code: "XXXX-YYYY", label: "Phone", expiresAt: 9 }, {}] }))
      .toEqual([{ code: "XXXX-YYYY", label: "Phone", expiresAt: 9 }]);
    expect(toHarnessPairings({ pairings: [{ id: "p1", label: "Phone", expiresAt: 9 }] }))
      .toEqual([{ code: "p1", label: "Phone", expiresAt: 9 }]);
    expect(toHarnessPairings({ id: "p2", code: "AAAA-BBBB", label: "", expiresAt: 9 }))
      .toEqual([{ code: "AAAA-BBBB", label: "", expiresAt: 9 }]);
    expect(toHarnessPairings({ pairings: [] })).toEqual([]);
  });

  it("reads usage groups with a safe numeric floor", () => {
    const { groups, total } = toUsageGroups({
      groups: [{ key: "a@b.co", label: "a@b.co", input: 10, output: 5, costUsd: 0.25 }, { nope: true }],
      total: { key: "total", label: "total", input: 10, output: 5, costUsd: 0.25 },
    });
    expect(groups).toEqual([{ key: "a@b.co", label: "a@b.co", input: 10, output: 5, costUsd: 0.25 }]);
    expect(total?.key).toBe("total");
    expect(toUsageGroups(null)).toEqual({ groups: [], total: null });
  });

  it("reads bots, threads, messages, and activity defensively", () => {
    expect(toHarnessBots({ bots: [{ id: "b1", name: "Bot", threadId: "t1", tasks: [{ threadId: "t2", title: "Second" }] }, null] })).toEqual([{
      id: "b1", name: "Bot", threadId: "t1", threads: [{ threadId: "t1", title: "t1" }, { threadId: "t2", title: "Second" }],
    }]);
    expect(toHarnessMessages({ messages: [{ id: "m1", role: "user", kind: "text", text: "hi" }, { role: "bot", kind: "activity", tool: { name: "read" } }] }))
      .toEqual([
        { id: "m1", role: "user", kind: "text", text: "hi" },
        { id: "m1", role: "bot", kind: "activity", text: "read" },
      ]);
    expect(toHarnessActivity({ activity: [{ id: "a1", category: "bot", action: "bot.created", target: { name: "Bot" }, actor: { email: "a@b.co" }, createdAt: 7 }, {}] }))
      .toEqual([{ id: "a1", category: "bot", action: "bot.created", summary: "a@b.co · Bot", createdAt: 7 }]);
  });

  it("reads health from the app/process shape", () => {
    expect(toHarnessHealth({ app: "maximus", pid: 1 })).toEqual({ ok: true, version: "" });
    expect(toHarnessHealth({ ok: true })).toEqual({ ok: true, version: "" });
    expect(toHarnessHealth(null)).toEqual({ ok: false, version: "" });
  });

  it("reads key status through the settings catalog", () => {
    const openai = keyEntry("openai");
    expect(keySavedState(openai, { openai: { configured: true, last4: "ab12" } })).toEqual({ configured: true, last4: "ab12" });
    expect(keySavedState(openai, {})).toEqual({ configured: false });
    expect(keySavedState(openai, null)).toEqual({ configured: false });
  });
});

describe("harness api client", () => {
  it("carries same-origin cookies and surfaces server errors", async () => {
    const fetchImpl = stubFetch((url) => {
      if (url === "/api/config") return { status: 200, body: { signIn: { admins: [], members: [] } } };
      return { status: 403, body: { error: "forbidden" } };
    });
    await expect(harnessConfig({ fetchImpl })).resolves.toMatchObject({ signIn: { admins: [] } });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.credentials).toBe("same-origin");
    const failure = await harnessBots({ fetchImpl }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HarnessError);
    expect(failure).toMatchObject({ status: 403, message: "forbidden" });
  });

  it("writes access, sessions, and messages with JSON bodies", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = stubFetch((url, init) => {
      seen.push({ url, init });
      if (url === "/api/usage?groupBy=user") return { status: 200, body: { groups: [], total: null } };
      return { status: 200, body: { ok: true } };
    });
    await saveHarnessConfig({ signIn: { admins: ["a@b.co"], members: [] } }, { fetchImpl });
    expect(seen[0]?.init?.method).toBe("PUT");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({ signIn: { admins: ["a@b.co"], members: [] } });
    await revokeHarnessSession("s1", { fetchImpl });
    expect(seen[1]).toMatchObject({ url: "/api/auth/sessions/s1" });
    expect(seen[1]?.init?.method).toBe("DELETE");
    await harnessSendMessage("b1", { text: "hi", threadId: "t1" }, { fetchImpl });
    expect(seen[2]?.url).toBe("/api/bots/b1/messages");
    expect(JSON.parse(String(seen[2]?.init?.body))).toEqual({ text: "hi", threadId: "t1" });
    await harnessSessions({ fetchImpl });
    await harnessUsage("user", { fetchImpl });
    expect(seen.map((call) => call.url)).toContain("/api/auth/sessions");
    expect(seen.map((call) => call.url)).toContain("/api/usage?groupBy=user");
  });
});
