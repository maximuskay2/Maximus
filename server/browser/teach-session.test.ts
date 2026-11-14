import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  beginBrowserTeach, beginTeachSession, finishTeachSession, isTeaching, loadSkill, recordBrowserCall, recordBrowserStep, replayTaughtSkill,
} from "./teach-session.ts";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function temp(): string {
  const folder = mkdtempSync(join(tmpdir(), "maximus-teach-"));
  folders.push(folder);
  return folder;
}

describe("browser teach session", () => {
  it("records steps for a thread and replays the saved skill with a parameter", () => {
    const dir = temp();
    beginTeachSession("thread-1", "fill-title");
    recordBrowserStep("thread-1", { verb: "navigate", text: "https://example.com/new" });
    recordBrowserCall("thread-1", "agent_browser_fill", { selector: "#title", text: "{{title}}" });
    recordBrowserCall("thread-1", "agent_browser_click", { ref: "e4" });
    recordBrowserCall("thread-1", "agent_browser_scroll", { dy: 600 });
    recordBrowserCall("thread-2", "agent_browser_click", { ref: "e9" });
    const skill = finishTeachSession(dir, "thread-1");
    expect(skill?.parameters).toEqual(["title"]);
    expect(skill?.steps.map((step) => step.verb)).toEqual(["navigate", "fill", "click"]);
    expect(isTeaching("thread-1")).toBe(false);
    expect(loadSkill(dir, "fill-title")).toEqual(skill);
    const ran: string[] = [];
    replayTaughtSkill(dir, "fill-title", { title: "second" }, (step) => { ran.push(step.text ?? step.selector ?? ""); }, () => true);
    expect(ran).toEqual(["https://example.com/new", "second", "e4"]);
  });

  it("starts only for a browser /learn request and writes nothing for an empty recording", () => {
    const dir = temp();
    beginBrowserTeach("thread-3", "/learn how to file an expense");
    expect(isTeaching("thread-3")).toBe(false);
    beginBrowserTeach("thread-3", "/learn the browser steps to file an expense");
    expect(isTeaching("thread-3")).toBe(true);
    expect(finishTeachSession(dir, "thread-3")).toBeNull();
    expect(loadSkill(dir, "the-browser-steps-to-file-an-expense")).toBeNull();
  });

  it("refuses a skill name that is a path", () => {
    beginTeachSession("thread-4", "ok");
    recordBrowserStep("thread-4", { verb: "navigate", text: "https://example.com" });
    expect(() => finishTeachSession(temp(), "thread-4", "../escape")).toThrow();
  });
});
