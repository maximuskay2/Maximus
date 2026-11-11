import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BACKGROUND_KEEPS_AWAKE_MS, awakeHold } from "./cloud-computer-background.ts";
import { guardedBrowserAction } from "./browser/sensitive-page.ts";
import { botSpendRefusal, noteBotSpend, readBotSpend } from "./billing/bot-ceiling.ts";
import { readCacheDebit, readCacheKey } from "./billing/read-cache.ts";
import { modelForBundledTask, rewriteModel, taskClass } from "./billing/task-route.ts";
import { deliverRunner } from "./external-runners.ts";
import { newBotComputer } from "./host/new-bot-computer.ts";
import { deliverHandoff } from "./room-handoff.ts";
import { recordSkill, replaySkill } from "./skill-replay.ts";
import { interruptParkedTurns, parkTurn, readParkedTurns } from "./turn-resume.ts";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function temp(): string {
  const folder = mkdtempSync(join(tmpdir(), "maximus-release-b-"));
  folders.push(folder);
  return folder;
}

describe("release B", () => {
  it("keeps a parked turn and marks it interrupted without touching the transcript", () => {
    const dir = temp();
    const transcript = join(dir, "transcript.txt");
    writeFileSync(transcript, "the turn so far");
    parkTurn(dir, { botId: "bot-a", turnId: "turn-1", threadId: "thread-1" });
    expect(readParkedTurns(dir)).toEqual([{ botId: "bot-a", turnId: "turn-1", threadId: "thread-1", status: "running" }]);
    expect(interruptParkedTurns(dir)[0]).toMatchObject({ status: "interrupted", turnId: "turn-1" });
    expect(readFileSync(transcript, "utf8")).toBe("the turn so far");
  });

  it("gives a new bot its own computer and browser profile", () => {
    const first = newBotComputer("bot-a");
    const second = newBotComputer("bot-b");
    expect(second.vm.key).not.toBe(first.vm.key);
    expect(second.vm.containerName).not.toBe(first.vm.containerName);
    expect(second.browserProfileId).toBe("bot-b");
    expect(second.browserSession).not.toBe(first.browserSession);
  });

  it("debits a paid hold past two hours and stops an unpaid one", () => {
    const start = 1_000;
    const past = start + BACKGROUND_KEEPS_AWAKE_MS + 3_600_000;
    expect(awakeHold(start, start + 60_000, 0, 0)).toEqual({ keep: true, debitUsd: 0 });
    expect(awakeHold(start, past, 0, 2).keep).toBe(false);
    expect(awakeHold(start, past, 5, 2)).toEqual({ keep: true, debitUsd: 2 });
  });

  it("hands a task to the other bot without writing it into the sender's memory", () => {
    const dir = temp();
    const memory = join(dir, "bot-a.memory");
    writeFileSync(memory, "bot a notes");
    deliverHandoff(dir, { fromBot: "bot-a", toBot: "bot-b", taskId: "task-1", payload: "private payload", threadId: "thread-9" });
    expect(readFileSync(memory, "utf8")).toBe("bot a notes");
    expect(readFileSync(join(dir, "bot-b.thread-9.thread"), "utf8")).toContain("private payload");
  });

  it("opens an approval for checkout and does not submit", () => {
    let submitted = false;
    const held = guardedBrowserAction("Card number and Place order", () => { submitted = true; });
    expect(held).toEqual({ submitted: false, approval: "checkout" });
    expect(submitted).toBe(false);
    const ordinary = guardedBrowserAction("A normal article", () => { submitted = true; });
    expect(ordinary.submitted).toBe(true);
  });

  it("uses the cheap model for format, the selected model for reason, and skips bring-your-own", () => {
    const cheap = "muse-spark-1.3";
    const format = JSON.stringify({ model: "muse-wonder-1.0", input: "format this list" });
    const reason = JSON.stringify({ model: "muse-wonder-1.0", input: "decide the design" });
    expect(taskClass(format)).toBe("format");
    expect(JSON.parse(rewriteModel(format, modelForBundledTask(format, cheap, false)!)).model).toBe(cheap);
    expect(modelForBundledTask(reason, cheap, false)).toBeNull();
    expect(modelForBundledTask(format, cheap, true)).toBeNull();
  });

  it("stops the bot that reached its ceiling and leaves the other bot running", () => {
    const dir = temp();
    noteBotSpend(dir, "bot-a", 2);
    noteBotSpend(dir, "bot-b", 0.25);
    expect(botSpendRefusal(readBotSpend(dir, "bot-a"), 1)?.code).toBe("spend_cap");
    expect(botSpendRefusal(readBotSpend(dir, "bot-b"), 1)).toBeNull();
  });

  it("runs one webhook delivery once and waits for approval", () => {
    const seen = new Set<string>();
    const manifest = { name: "hooks", url: "https://hooks.example/run", auth: "token", inputSchema: { task: "string" }, bots: ["bot-a"] };
    let calls = 0;
    expect(deliverRunner(seen, manifest, "event-1", false, () => { calls += 1; })).toBe("needs-approval");
    expect(deliverRunner(seen, manifest, "event-1", true, () => { calls += 1; })).toBe("ran");
    expect(deliverRunner(seen, manifest, "event-1", true, () => { calls += 1; })).toBe("duplicate");
    expect(calls).toBe(1);
  });

  it("replays a recorded skill with a new parameter and still asks for approval", () => {
    const skill = recordSkill("fill-title", [
      { verb: "fill", selector: "#title", label: "Title", text: "{{title}}" },
      { verb: "click", selector: "#pay", label: "Place order", needsApproval: true },
    ]);
    expect(skill.parameters).toEqual(["title"]);
    const ran: string[] = [];
    const steps = replaySkill(skill, { title: "second" }, (step) => { ran.push(step.text ?? step.label ?? ""); }, () => false);
    expect(steps.map((step) => step.text ?? step.label)).toEqual(["second"]);
    expect(ran).toEqual(["second"]);
  });

  it("caches a read trace for free and misses a POST", () => {
    expect(readCacheKey([{ method: "GET", tool: "read" }], "same question")).toBe("same question");
    expect(readCacheDebit(true)).toEqual({ debitUsd: 0 });
    expect(readCacheKey([{ method: "POST", tool: "send" }], "same question")).toBeNull();
    expect(readCacheKey([{ method: "GET", tool: "click" }], "same question")).toBeNull();
  });
});
