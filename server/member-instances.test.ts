import { describe, expect, it } from "vitest";

import { memberInstanceCatalog } from "./member-instances.ts";

describe("the engine catalog a signed-in account sees", () => {
  it("drops executable paths and install commands", () => {
    const [row] = memberInstanceCatalog([{
      instanceId: "codex",
      displayName: "Codex",
      snapshot: { state: "available" },
      authentication: { method: "device-code", signOut: true },
      cli: "/secret/bin/codex",
      cliDefault: "codex",
      cliCandidates: ["/secret/bin/codex"],
      install: { command: "secret" },
    }]) as Array<Record<string, unknown>>;
    expect(row).toEqual({
      instanceId: "codex",
      displayName: "Codex",
      snapshot: { state: "available" },
      authentication: { method: "device-code", signOut: true },
    });
    expect(JSON.stringify(row)).not.toContain("/secret");
  });
});
