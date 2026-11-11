import { describe, expect, it } from "vitest";

import { readOperatorMail, smtpUrl } from "../src/operator-mail.ts";
import { handleRequest } from "../src/router.ts";
import { createExecutionContext, testDeps, testEnv } from "./harness.ts";

const TOKEN = "operator-mail-token";

async function call(token: string | null, method: string, body?: unknown) {
  const ctx = createExecutionContext();
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await handleRequest(new Request("https://auth.maximus.test/api/operator/mail", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), testDeps(testEnv({ MAXIMUS_OPERATOR_TOKEN: TOKEN }), ctx));
  return [response.status, await response.json()] as const;
}

describe("operator mail", () => {
  it("saves the mailbox for the next message and does not return the password", async () => {
    expect((await call(null, "GET"))[0]).toBe(401);
    expect((await call("wrong", "PUT", { host: "smtp.example.com", port: 587, username: "ada", password: "s3cret", from: "ada@example.com" }))[0]).toBe(403);

    const saved = await call(TOKEN, "PUT", {
      host: "smtp.example.com", port: 587, username: "ada", password: "s3cret", from: "ada@example.com",
    });
    expect(saved[0]).toBe(200);
    expect(JSON.stringify(saved[1])).not.toContain("s3cret");
    expect(saved[1]).toMatchObject({ host: "smtp.example.com", from: "ada@example.com", passwordSet: true });

    const kept = await call(TOKEN, "PUT", {
      host: "smtp.example.com", port: 2525, username: "ada", password: "", from: "next@example.com",
    });
    expect(kept[1]).toMatchObject({ port: 2525, from: "next@example.com", passwordSet: true });
    const stored = await readOperatorMail(testEnv());
    expect(stored?.password).toBe("s3cret");
    expect(smtpUrl(stored!)).toBe(`smtp://${encodeURIComponent("ada")}:${encodeURIComponent("s3cret")}@smtp.example.com:2525`);
  });

  it("reports the operator token missing", async () => {
    const ctx = createExecutionContext();
    const response = await handleRequest(new Request("https://auth.maximus.test/api/operator/mail"), testDeps(testEnv(), ctx));
    expect(response.status).toBe(503);
  });
});
