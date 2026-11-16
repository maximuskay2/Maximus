import { hostname } from "node:os";
import { createRequire } from "node:module";

const { getLocalOrigin } = createRequire(import.meta.url)("./local-origin.cjs");

const STALE_MS = 90_000;
let timer = null;

async function beat() {
  const origin = getLocalOrigin();
  if (!origin) return;
  try {
    await fetch(`${origin}/api/agent-os/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "self",
        name: hostname() || "This computer",
        kind: "this_desktop",
        capabilities: ["computer", "browser", "connector"],
      }),
    });
  } catch {
    /* local server may not be up yet */
  }
}

export function startAgentOsHeartbeat() {
  if (timer) return;
  void beat();
  timer = setInterval(() => void beat(), Math.floor(STALE_MS / 3));
  timer.unref?.();
}

export function stopAgentOsHeartbeat() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
