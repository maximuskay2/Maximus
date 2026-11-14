const HIDDEN_FROM_MEMBERS = ["cli", "cliDefault", "cliCandidates", "install"] as const;

/** A signed-in account sees which engines exist. Executable paths and install commands stay on the admin catalog. */
export function memberInstanceCatalog(instances: unknown): unknown[] {
  if (!Array.isArray(instances)) return [];
  return instances.map((row) => {
    if (!row || typeof row !== "object") return row;
    const copy = { ...(row as Record<string, unknown>) };
    for (const key of HIDDEN_FROM_MEMBERS) delete copy[key];
    return copy;
  });
}
