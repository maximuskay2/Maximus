import { describe, expect, it } from "vitest";

import { createVisibilityHost } from "./visibility-host.ts";
import type { RequestAuth } from "../request-auth.ts";

const bots = [
  { id: "place", threadId: "t-place", defaultBot: {}, tasks: [{ threadId: "t-place" }] },
  { id: "owner", threadId: "t-owner", createdBy: "owner@example.test", defaultBot: { person: "owner@example.test" }, tasks: [{ threadId: "t-owner" }] },
  { id: "tester", threadId: "t-tester", createdBy: "oluwakemi.umoren@gmail.com", defaultBot: { person: "oluwakemi.umoren@gmail.com" }, tasks: [{ threadId: "t-tester" }] },
];

function host() {
  return createVisibilityHost({
    store: () => ({
      bots,
      groups: [],
      bot: (id: string) => bots.find((bot) => bot.id === id),
      group: () => undefined,
      botByThread: (threadId: string) => bots.find((bot) => bot.threadId === threadId || bot.tasks.some((task) => task.threadId === threadId)),
      groupByThread: () => undefined,
      patchGroup: () => undefined,
    }) as never,
    routines: () => null,
    team: false,
    ownAccounts: true,
    audiencesFor: () => undefined,
    threadsReferencing: () => [],
  });
}

const admin = {
  kind: "session",
  via: "cookie",
  scopes: ["admin", "client"],
  session: { email: "owner@example.test", scopes: ["admin", "client"] },
} as unknown as RequestAuth;

describe("personal accounts", () => {
  it("keeps an admin session to its own bots and chats", () => {
    const { viewerFor, visibleTo } = host();
    const visible = visibleTo(viewerFor(admin));
    expect(visible.everything).toBe(false);
    expect([visible.bot("owner"), visible.bot("tester"), visible.bot("place")]).toEqual([true, false, false]);
    expect([visible.thread("t-owner"), visible.thread("t-tester"), visible.thread("t-place")]).toEqual([true, false, false]);
  });
});
