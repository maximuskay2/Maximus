import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-maximus.ts";

it("lists this computer on an isolated fixture and binds the next turn to it", async () => {
  const fixture = await launchVerificationServer();
  try {
    const listed = await fetch(`${fixture.info.url}/api/agent-os/machines`, {
      headers: { origin: fixture.info.url },
    });
    expect(listed.status).toBe(200);
    const payload = await listed.json() as { selfId: string; machines: Array<{ id: string; online: boolean }> };
    expect(payload.selfId).toBe("self");
    expect(payload.machines.some((row) => row.id === "self" && row.online)).toBe(true);

    const assigned = await fetch(`${fixture.info.url}/api/agent-os/assignment`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: fixture.info.url },
      body: JSON.stringify({ machineId: "self" }),
    });
    expect(assigned.status).toBe(200);

    const routed = await fetch(`${fixture.info.url}/api/agent-os/route`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: fixture.info.url },
      body: JSON.stringify({ machineId: "self", capability: "computer" }),
    });
    expect(routed.status).toBe(200);
    expect(await routed.json()).toEqual(expect.objectContaining({ ok: true, target: "local", dispatch: "cua" }));

    const git = await fetch(`${fixture.info.url}/api/agent-os/plugins/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: fixture.info.url },
      body: JSON.stringify({ mode: "local", app: "git", action: "lookup" }),
    });
    expect(git.status).toBe(200);
    expect(await git.json()).toEqual(expect.objectContaining({ app: "git", as: "owner", account: "owner", bound: true, machineId: "self" }));
  } finally {
    await fixture.close();
  }
}, 60_000);
