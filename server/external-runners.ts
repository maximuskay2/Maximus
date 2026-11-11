export interface RunnerManifest {
  name: string;
  url: string;
  auth: string;
  inputSchema: Record<string, string>;
  bots: string[];
}

export function deliverRunner(
  seen: Set<string>,
  manifest: RunnerManifest,
  key: string,
  approved: boolean,
  call: (manifest: RunnerManifest) => void,
): "ran" | "duplicate" | "needs-approval" {
  if (!approved) return "needs-approval";
  if (!manifest.url || manifest.bots.length === 0) return "needs-approval";
  if (seen.has(key)) return "duplicate";
  seen.add(key);
  call(manifest);
  return "ran";
}
