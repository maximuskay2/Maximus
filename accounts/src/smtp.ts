import nodemailer from "nodemailer";

import type { TransactionalEmailSender } from "./email.ts";

export function smtpSender(url: string): TransactionalEmailSender {
  const transport = nodemailer.createTransport(url);
  return {
    send: async (message) => {
      await transport.sendMail({
        from: `${message.from.name} <${message.from.email}>`,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}
