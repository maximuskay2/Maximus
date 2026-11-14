import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { createPasswordAccounts } from "../password-accounts.ts";
import type { Scope } from "../sessions.ts";
import { createPasswordResetMail } from "../password-reset.ts";
import { passwordAuthRoute } from "./password-auth.ts";

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    // temp dirs are left for the OS; nothing else to clean
    void folder;
  }
});

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
  });
}

it("resets a password through the forgot/reset routes", async () => {
  const folder = mkdtempSync(join(tmpdir(), "maximus-pw-route-"));
  folders.push(folder);
  const file = join(folder, "password-accounts.json");
  const accounts = createPasswordAccounts(file);
  expect(accounts.signup("ada@example.com", "correct-horse")).toMatchObject({ ok: true });
  const sent: { text: string }[] = [];
  const resets = createPasswordResetMail({
    accounts,
    url: "smtp://user:pass@127.0.0.1:1025",
    from: "info@example.com",
    origin: () => "https://app.example",
    transport: { sendMail: async (message) => { sent.push({ text: message.text }); } },
  });
  const sessions = {
    attemptAllowed: () => ({ ok: true as const }),
    noteFailure: () => undefined,
    clearFailures: () => undefined,
    issue: () => ({ token: "tok", session: { id: "s1", label: "Browser", scopes: ["client"] as Scope[], createdAt: 1, lastSeenAt: 1, expiresAt: 2 } }),
  };
  const { url, close } = await listen((req, res) => {
    void passwordAuthRoute({
      file,
      cloudHome: false,
      hosted: false,
      sessions,
      cookieName: "maximus",
      environment: () => ({}),
      accounts,
      resets,
      env: { MAXIMUS_SIGNIN_SMTP_URL: "smtp://user:pass@127.0.0.1:1025", MAXIMUS_SIGNIN_SMTP_FROM: "info@example.com" },
    }, req, res, req.url?.split("?")[0] ?? "", req.method ?? "GET");
  });
  try {
    const forgot = await fetch(`${url}/api/auth/password/forgot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com" }),
    });
    expect(forgot.status).toBe(200);
    const token = decodeURIComponent(/token=([^&\s]+)/.exec(sent[0]!.text)?.[1] ?? "");
    const reset = await fetch(`${url}/api/auth/password/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password: "brand-new-secret" }),
    });
    expect(reset.status).toBe(200);
    expect(accounts.signin("ada@example.com", "brand-new-secret")).toMatchObject({ ok: true });
  } finally {
    await close();
  }
});
