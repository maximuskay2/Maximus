import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Handoff {
  fromBot: string;
  toBot: string;
  taskId: string;
  payload: string;
  threadId: string;
}

function safeName(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new Error("handoff name");
  return value;
}

export function deliverHandoff(dir: string, handoff: Handoff): void {
  const toBot = safeName(handoff.toBot);
  const threadId = safeName(handoff.threadId);
  mkdirSync(dir, { recursive: true });
  const thread = join(dir, `${toBot}.${threadId}.thread`);
  let existing = "";
  try {
    existing = readFileSync(thread, "utf8");
  } catch {
    existing = "";
  }
  const line = `${handoff.taskId}\n${handoff.payload}\n`;
  writeFileSync(thread, existing + line);
}
