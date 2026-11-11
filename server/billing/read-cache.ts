const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const WRITE_TOOLS = ["click", "send", "payment", "pay"];

export function readCacheKey(trace: { method: string; tool: string }[], input: string): string | null {
  if (trace.length === 0 || !input) return null;
  for (const step of trace) {
    if (WRITES.has(step.method.toUpperCase())) return null;
    const tool = step.tool.toLowerCase();
    if (WRITE_TOOLS.some((name) => tool.includes(name))) return null;
  }
  return input;
}

export function readCacheDebit(hit: boolean): { debitUsd: number } {
  return { debitUsd: hit ? 0 : 1 };
}
