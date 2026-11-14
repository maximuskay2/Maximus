import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactSecretsInText } from "../redact.ts";
import { parseLearnCommand, parseSaveRunRequest } from "../skill-learn.ts";
import { recordSkill, replaySkill, type RecordedSkill, type SkillStep } from "../skill-replay.ts";

interface TeachSession {
  name: string;
  steps: SkillStep[];
}

const sessions = new Map<string, TeachSession>();

const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

function slug(request: string): string {
  const name = request.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");
  return name || "browser-skill";
}

function skillFile(dir: string, name: string): string {
  if (!SKILL_NAME.test(name)) throw new Error("skill name");
  return join(dir, `${name}.json`);
}

export function beginTeachSession(threadId: string, name: string): void {
  sessions.set(threadId, { name, steps: [] });
}

/** Starts a recording when a /learn request on this thread is about the browser. */
export function beginBrowserTeach(threadId: string, text: string): void {
  const request = (parseLearnCommand(text) ?? parseSaveRunRequest(text))?.request;
  if (request === undefined || !/\bbrowser\b/i.test(request)) return;
  beginTeachSession(threadId, slug(request));
}

export function isTeaching(threadId: string): boolean {
  return sessions.has(threadId);
}

export function recordBrowserStep(threadId: string, step: SkillStep): void {
  sessions.get(threadId)?.steps.push(step);
}

export function stepFromBrowserCall(tool: string, input: Record<string, unknown> | undefined): SkillStep | null {
  const text = (key: string): string | undefined => (typeof input?.[key] === "string" ? input[key] : undefined);
  const selector = text("selector") ?? text("ref");
  switch (tool) {
    case "agent_browser_click":
      return selector === undefined ? null : { verb: "click", selector };
    case "agent_browser_fill": {
      const value = text("text");
      return selector === undefined || value === undefined ? null : { verb: "fill", selector, text: redactSecretsInText(value) };
    }
    case "agent_browser_open":
    case "agent_browser_navigate": {
      const url = text("url");
      return url === undefined || url.trim() === "" ? null : { verb: "navigate", text: url };
    }
    default:
      return null;
  }
}

export function recordBrowserCall(threadId: string, tool: string, input: Record<string, unknown> | undefined): void {
  if (!sessions.has(threadId)) return;
  const step = stepFromBrowserCall(tool, input);
  if (step) recordBrowserStep(threadId, step);
}

/** Ends the thread's recording; a recording with no steps writes nothing. */
export function finishTeachSession(dir: string, threadId: string, name?: string): RecordedSkill | null {
  const session = sessions.get(threadId);
  sessions.delete(threadId);
  if (!session || session.steps.length === 0) return null;
  const skill = recordSkill(name ?? session.name, session.steps);
  const file = skillFile(dir, skill.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(skill, null, 2));
  return skill;
}

export function loadSkill(dir: string, name: string): RecordedSkill | null {
  try {
    const value: unknown = JSON.parse(readFileSync(skillFile(dir, name), "utf8"));
    if (!value || typeof value !== "object") return null;
    const skill = value as RecordedSkill;
    return typeof skill.name === "string" && Array.isArray(skill.parameters) && Array.isArray(skill.steps) ? skill : null;
  } catch {
    return null;
  }
}

export function replayTaughtSkill(
  dir: string,
  name: string,
  values: Record<string, string>,
  act: (step: SkillStep) => void,
  approve: (step: SkillStep) => boolean,
): SkillStep[] {
  const skill = loadSkill(dir, name);
  return skill ? replaySkill(skill, values, act, approve) : [];
}
