import { describe, expect, it } from "vitest";

import { createAuth } from "../src/auth.ts";
import { handleRequest } from "../src/router.ts";
import { BASE_URL, createExecutionContext, env, TEST_CRON_SECRET, testConfig, testDeps, testPool, waitOnExecutionContext } from "./harness.ts";

async function cron(headers: Record<string, string> = {}) {
  const ctx = createExecutionContext();
  const response = await handleRequest(new Request(`${BASE_URL}/internal/cron`, {
    method: "POST",
    headers,
  }), testDeps(env, ctx));
  await waitOnExecutionContext(ctx);
  return response;
}

describe("cron", () => {
  it("refuses the cleanup without the shared secret", async () => {
    expect((await cron()).status).toBe(401);
    expect((await cron({ authorization: "Bearer wrong-secret" })).status).toBe(401);
    expect((await cron({ authorization: "Bearer " })).status).toBe(401);
  });

  it("deletes only expired verifications", async () => {
    const ctx = createExecutionContext();
    const auth = createAuth(env, ctx, testConfig(), crypto.randomUUID(), testPool());
    await auth.api.createVerificationOTP({ body: { email: "cron-live@example.com", type: "sign-in" } });
    await auth.api.createVerificationOTP({ body: { email: "cron-stale@example.com", type: "sign-in" } });
    await waitOnExecutionContext(ctx);
    await env.DB.prepare('UPDATE "verification" SET "expiresAt" = ? WHERE "identifier" = ?')
      .bind(new Date(Date.now() - 1), "sign-in-otp-cron-stale@example.com").run();

    const response = await cron({ authorization: `Bearer ${TEST_CRON_SECRET}` });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const rows = await env.DB.prepare('SELECT identifier FROM "verification" ORDER BY identifier')
      .all<{ identifier: string }>();
    expect(rows.results.map((row) => row.identifier)).toEqual(["sign-in-otp-cron-live@example.com"]);
  });
});
