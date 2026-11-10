import { describe, expect, it, vi } from "vitest";

import type { NotificationLogEntry } from "../shared/notification.ts";
import type { FcmMessage, FcmSender } from "./mobile-push-fcm.ts";
import { createPushFanout, FYI_THREAD_WINDOW_MS } from "./mobile-push.ts";

const entry = (overrides: Partial<NotificationLogEntry> = {}): NotificationLogEntry => ({
  id: "n1", at: 1, kind: "done", botId: "b1", botName: "Scout",
  threadId: "t1", title: "Done", body: "all finished", read: false,
  ...overrides,
});

interface Harness {
  sent: FcmMessage[];
  removed: string[];
  fanout: ReturnType<typeof createPushFanout>;
  clock: { now: number };
  desktop: { live: boolean };
  muted: Set<string>;
  global: { on: boolean };
}

function harness(options: {
  tokens?: Array<{ token: string; personKey?: string | null }>;
  sender?: FcmSender | null;
} = {}): Harness {
  const sent: FcmMessage[] = [];
  const removed: string[] = [];
  const clock = { now: 1_000_000 };
  const desktop = { live: false };
  const muted = new Set<string>();
  const global = { on: true };
  const sender: FcmSender | null = options.sender === undefined
    ? { send: vi.fn(async (message: FcmMessage) => { sent.push(message); return { ok: true as const, messageId: "m1" }; }), close: () => {} }
    : options.sender;
  const fanout = createPushFanout({
    tokens: () => (options.tokens ?? [{ token: "tok1" }]).map((t) => ({
      token: t.token, platform: "ios" as const, deviceName: null,
      personKey: t.personKey ?? null, appVersion: null,
    })),
    removeToken: (token) => { removed.push(token); },
    botMuted: (botId) => muted.has(botId),
    globalEnabled: () => global.on,
    desktopLive: () => desktop.live,
    sender,
    clock: () => clock.now,
  });
  return { sent, removed, fanout, clock, desktop, muted, global };
}

describe("mobile push fanout", () => {
  it("stays quiet without FCM credentials", async () => {
    const h = harness({ sender: null });
    const decision = await h.fanout.fanout(entry());
    expect(decision).toEqual({ delivered: 0, skipped: "push unavailable (no FCM credentials)" });
    expect(h.sent).toHaveLength(0);
  });

  it("honors the global switch", async () => {
    const h = harness();
    h.global.on = false;
    expect(await h.fanout.fanout(entry({ kind: "approval" }))).toMatchObject({ delivered: 0 });
    expect(h.sent).toHaveLength(0);
  });

  it("delivers FYI with thread collapse + deep-link data", async () => {
    const h = harness();
    const decision = await h.fanout.fanout(entry());
    expect(decision.delivered).toBe(1);
    expect(h.sent[0]).toMatchObject({
      token: "tok1",
      title: "Done",
      collapseKey: "t1",
      highPriority: false,
      data: { kind: "done", notificationId: "n1", botId: "b1", threadId: "t1" },
    });
  });

  it("marks needs-you high priority", async () => {
    const h = harness();
    await h.fanout.fanout(entry({ kind: "approval" }));
    expect(h.sent[0]).toMatchObject({ highPriority: true });
  });

  it("desktop-preferred: a live desktop eats FYI, urgent still pushes", async () => {
    const h = harness();
    h.desktop.live = true;
    expect(await h.fanout.fanout(entry())).toMatchObject({ delivered: 0, skipped: "desktop live" });
    expect(await h.fanout.fanout(entry({ kind: "question" }))).toMatchObject({ delivered: 1 });
  });

  it("a muted bot silences FYI only", async () => {
    const h = harness();
    h.muted.add("b1");
    expect(await h.fanout.fanout(entry())).toMatchObject({ delivered: 0, skipped: "bot muted" });
    expect(await h.fanout.fanout(entry({ kind: "approval" }))).toMatchObject({ delivered: 1 });
  });

  it("coalesces one thread's FYI inside the window, then sends again", async () => {
    const h = harness();
    expect((await h.fanout.fanout(entry())).delivered).toBe(1);
    expect((await h.fanout.fanout(entry({ id: "n2" }))).delivered).toBe(0);
    h.clock.now += FYI_THREAD_WINDOW_MS + 1;
    expect((await h.fanout.fanout(entry({ id: "n3" }))).delivered).toBe(1);
  });

  it("never coalesces needs-you", async () => {
    const h = harness();
    expect((await h.fanout.fanout(entry({ kind: "approval" }))).delivered).toBe(1);
    expect((await h.fanout.fanout(entry({ kind: "approval", id: "n2" }))).delivered).toBe(1);
  });

  it("caps FYI per phone per hour", async () => {
    const h = harness();
    for (let i = 0; i < 20; i += 1) {
      h.clock.now += FYI_THREAD_WINDOW_MS + 1;
      expect((await h.fanout.fanout(entry({ id: `n${i}`, threadId: `t${i}` }))).delivered).toBe(1);
    }
    h.clock.now += FYI_THREAD_WINDOW_MS + 1;
    expect((await h.fanout.fanout(entry({ id: "capped", threadId: "fresh" }))).delivered).toBe(0);
    // Urgent still goes (under the higher total cap).
    expect((await h.fanout.fanout(entry({ kind: "approval", id: "u1" }))).delivered).toBe(1);
  });

  it("scopes forPerson entries to the matching phone", async () => {
    const h = harness({ tokens: [{ token: "alice", personKey: "alice" }, { token: "bob", personKey: "bob" }] });
    await h.fanout.fanout(entry({ kind: "mention", forPerson: "bob" }));
    expect(h.sent.map((m) => m.token)).toEqual(["bob"]);
    await h.fanout.fanout(entry({ id: "n2" }));
    expect(h.sent.map((m) => m.token)).toEqual(["bob", "alice", "bob"]);
  });

  it("drops dead tokens", async () => {
    const dead: FcmSender = {
      send: vi.fn(async () => ({ ok: false as const, error: "gone", deadToken: true })),
      close: () => {},
    };
    const h = harness({ sender: dead });
    expect(await h.fanout.fanout(entry())).toMatchObject({ delivered: 0 });
    expect(h.removed).toEqual(["tok1"]);
  });

  it("keeps a token that failed transiently", async () => {
    const flaky: FcmSender = {
      send: vi.fn(async () => ({ ok: false as const, error: "boom", deadToken: false })),
      close: () => {},
    };
    const h = harness({ sender: flaky });
    expect(await h.fanout.fanout(entry())).toMatchObject({ delivered: 0 });
    expect(h.removed).toHaveLength(0);
  });
});
