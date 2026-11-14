import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { createPasswordAccounts } from "./password-accounts.ts";
import { createPasswordResetMail } from "./password-reset.ts";

it("mails a reset link and accepts it once", async () => {
  const accounts = createPasswordAccounts(join(mkdtempSync(join(tmpdir(), "maximus-reset-")), "password-accounts.json"));
  expect(accounts.signup("ada@example.com", "correct-horse")).toMatchObject({ ok: true });
  const sent: { to: string; text: string }[] = [];
  const mail = createPasswordResetMail({
    accounts,
    url: "smtp://user:pass@127.0.0.1:1025",
    from: "info@example.com",
    origin: () => "https://app.example",
    transport: {
      sendMail: async (message) => {
        sent.push({ to: message.to, text: message.text });
      },
    },
  });
  expect(await mail.request("ada@example.com")).toBe("sent");
  expect(await mail.request("missing@example.com")).toBe("sent");
  expect(sent).toHaveLength(1);
  const token = /token=([^&\s]+)/.exec(sent[0]!.text)?.[1];
  expect(token).toBeTruthy();
  const decoded = decodeURIComponent(token!);
  expect(mail.consume(decoded, "short")).toEqual({ ok: false, reason: "short-password" });
  expect(mail.consume(decoded, "brand-new-secret")).toEqual({ ok: true, email: "ada@example.com" });
  expect(mail.consume(decoded, "brand-new-secret")).toEqual({ ok: false, reason: "invalid" });
  expect(accounts.signin("ada@example.com", "brand-new-secret")).toMatchObject({ ok: true });
});

it("keeps a reset link after the mailer is opened again", async () => {
  const folder = mkdtempSync(join(tmpdir(), "maximus-reset-file-"));
  const accounts = createPasswordAccounts(join(folder, "password-accounts.json"));
  expect(accounts.signup("ada@example.com", "correct-horse")).toMatchObject({ ok: true });
  const sent: { text: string }[] = [];
  const options = {
    accounts,
    url: "smtp://user:pass@127.0.0.1:1025",
    from: "info@example.com",
    origin: () => "https://app.example",
    file: join(folder, "password-resets.json"),
    transport: { sendMail: async (message: { text: string }) => { sent.push({ text: message.text }); } },
  };
  expect(await createPasswordResetMail(options).request("ada@example.com")).toBe("sent");
  const decoded = decodeURIComponent(/token=([^&\s]+)/.exec(sent[0]!.text)?.[1] ?? "");
  const again = createPasswordResetMail(options);
  expect(again.consume(decoded, "brand-new-secret")).toEqual({ ok: true, email: "ada@example.com" });
});
