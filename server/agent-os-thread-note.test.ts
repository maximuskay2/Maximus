import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { noteAgentOsThread } from "./agent-os-thread-note.ts";
import { ThreadCache, dropCachedThread } from "./thread-cache.ts";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

it("does not write a transcript outside the running server's data dir", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "agent-os-note-"));
  folders.push(dataDir);
  expect(dataDir).not.toBe(DATA_DIR);
  expect(() => noteAgentOsThread(dataDir, "thread-1", "Office Mac is asleep.", false)).not.toThrow();
});

it("drops a cached thread so the next read reloads", () => {
  const cache = new ThreadCache(() => new Set());
  cache.load("t1", { messages: [{ id: "m1", at: 1, role: "bot", kind: "text", text: "hi" }], activeLeafId: "m1" });
  expect(cache.get("t1")?.messages).toHaveLength(1);
  dropCachedThread("t1");
  expect(cache.get("t1")).toBeUndefined();
});
