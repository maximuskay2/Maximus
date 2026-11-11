import { createServer, type Server, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildOTPEmail, type OTPEmailInput } from "../src/email.ts";
import { handleRequest } from "../src/router.ts";
import { smtpSender } from "../src/smtp.ts";
import { BASE_URL, createExecutionContext, env, testDeps, waitOnExecutionContext } from "./harness.ts";

interface CapturedMail {
  from: string;
  to: string[];
  data: string;
}

function startFixtureMailbox(): Promise<{ port: number; mail: CapturedMail[]; close: () => Promise<void> }> {
  const mail: CapturedMail[] = [];
  let server: Server;
  return new Promise((resolve) => {
    server = createServer((socket: Socket) => {
      socket.setEncoding("utf8");
      socket.write("220 fixture ESMTP\r\n");
      let from = "";
      let to: string[] = [];
      let data = "";
      let inData = false;
      let buffer = "";
      const reset = () => {
        from = "";
        to = [];
        data = "";
        inData = false;
      };
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        let index = buffer.indexOf("\r\n");
        while (index >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (inData) {
            if (line === ".") {
              mail.push({ from, to, data });
              reset();
              socket.write("250 queued\r\n");
            } else {
              data += (line.startsWith(".") ? line.slice(1) : line) + "\r\n";
            }
          } else if (/^ehlo/i.test(line)) {
            socket.write("250-fixture\r\n250 AUTH PLAIN\r\n");
          } else if (/^helo/i.test(line)) {
            socket.write("250 fixture\r\n");
          } else if (/^auth plain/i.test(line)) {
            socket.write("235 authenticated\r\n");
          } else if (/^mail from:/i.test(line)) {
            from = line.slice("mail from:".length).trim();
            socket.write("250 ok\r\n");
          } else if (/^rcpt to:/i.test(line)) {
            to.push(line.slice("rcpt to:".length).trim());
            socket.write("250 ok\r\n");
          } else if (/^data/i.test(line)) {
            inData = true;
            socket.write("354 end with .\r\n");
          } else if (/^rset/i.test(line)) {
            reset();
            socket.write("250 ok\r\n");
          } else if (/^quit/i.test(line)) {
            socket.write("221 bye\r\n");
            socket.end();
          } else if (/^noop/i.test(line)) {
            socket.write("250 ok\r\n");
          } else {
            socket.write("502 unimplemented\r\n");
          }
          index = buffer.indexOf("\r\n");
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: (server.address() as { port: number }).port,
        mail,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

let mailbox: { port: number; mail: CapturedMail[]; close: () => Promise<void> };

beforeAll(async () => {
  mailbox = await startFixtureMailbox();
});

afterAll(async () => {
  await mailbox.close();
});

const TYPES: { type: OTPEmailInput["type"]; subject: string }[] = [
  { type: "sign-in", subject: "Your Maximus sign-in code" },
  { type: "email-verification", subject: "Verify your Maximus email" },
  { type: "forget-password", subject: "Reset your Maximus password" },
  { type: "change-email", subject: "Confirm your Maximus email change" },
];

describe("SMTP mail", () => {
  it("delivers the four existing messages with their subjects and the 10-minute body", async () => {
    const sender = smtpSender(`smtp://127.0.0.1:${mailbox.port}`);
    for (const { type, subject } of TYPES) {
      mailbox.mail.length = 0;
      await sender.send(buildOTPEmail("noreply@maximus.test", {
        email: "recipient@example.com",
        otp: "12345678",
        type,
      }));
      expect(mailbox.mail).toHaveLength(1);
      const data = mailbox.mail[0]?.data ?? "";
      expect(data).toContain(`Subject: ${subject}`);
      expect(data).toContain("12345678");
      expect(data).toContain("It expires in 10 minutes.");
      expect(mailbox.mail[0]?.to.join(" ")).toContain("recipient@example.com");
    }
  });

  it("delivers a sign-in code end to end, and a wrong code fails closed", async () => {
    const sender = smtpSender(`smtp://127.0.0.1:${mailbox.port}`);
    const testEnv = { ...env, EMAIL: sender };
    mailbox.mail.length = 0;
    const sendCtx = createExecutionContext();
    const send = await handleRequest(new Request(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "smtp-proof@example.com", type: "sign-in" }),
    }), testDeps(testEnv, sendCtx));
    await waitOnExecutionContext(sendCtx);
    expect(send.status).toBe(200);
    expect(mailbox.mail).toHaveLength(1);
    const code = mailbox.mail[0]?.data.match(/(\d{8})/)?.[1] ?? "";
    expect(code).toMatch(/^\d{8}$/);

    const wrong = await handleRequest(new Request(`${BASE_URL}/api/auth/sign-in/email-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "smtp-proof@example.com", otp: "00000000", name: "Wrong" }),
    }), testDeps(testEnv, createExecutionContext()));
    expect(wrong.status).toBe(400);
    await expect(wrong.json()).resolves.toEqual({ error: "invalid_otp" });

    const ctx = createExecutionContext();
    const accepted = await handleRequest(new Request(`${BASE_URL}/api/auth/sign-in/email-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "smtp-proof@example.com", otp: code, name: "Right" }),
    }), testDeps(testEnv, ctx));
    await waitOnExecutionContext(ctx);
    expect(accepted.status).toBe(200);
  });
});
