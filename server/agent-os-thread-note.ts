import { randomUUID } from "node:crypto";

import { DATA_DIR } from "./config.ts";
import { appendMessage } from "./message-db.ts";
import { dropCachedThread } from "./thread-cache.ts";

export function noteAgentOsThread(dataDir: string, threadId: string | undefined, text: string, ok: boolean): void {
  if (!threadId || dataDir !== DATA_DIR) return;
  const line = text.trim().slice(0, 2_000);
  if (!line) return;
  const at = Date.now();
  const id = randomUUID();
  try {
    appendMessage(threadId, {
      id,
      at,
      role: "bot",
      kind: "activity",
      text: line,
      tool: { name: `notice: ${line}`, ok },
    });
    dropCachedThread(threadId);
  } catch {
    /* unit hosts that are not the running server keep no transcript */
  }
}
