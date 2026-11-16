import { describe, expect, it } from "vitest";

import { createGrantMail } from "./grant-mail.ts";
import type { MailMessage } from "../sign-in-mail.ts";

describe("grant mail", () => {
  it("mails a credit notice with HTML and skips a bad address", async () => {
    const sent: MailMessage[] = [];
    const mail = createGrantMail({
      url: "smtp://user:pass@127.0.0.1:1025",
      from: "billing@example.test",
      appUrl: "https://app.meetnote.cc",
      transport: { sendMail: async (message) => { sent.push(message); } },
    });
    expect(await mail.send({ email: "not-an-email", creditUsd: 1 })).toBe("skipped");
    expect(sent).toHaveLength(0);
    expect(await mail.send({
      email: "Ada@Example.com",
      creditUsd: 2.5,
      plan: "starter",
      leftUsd: 10.5,
      note: "bank transfer",
    })).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: "billing@example.test",
      to: "ada@example.com",
    });
    expect(sent[0]!.subject).toContain("$2.50");
    expect(sent[0]!.text).toContain("Credit added: $2.50");
    expect(sent[0]!.html).toContain("Starter");
    expect(sent[0]!.html).toContain("https://app.meetnote.cc");
  });
});
