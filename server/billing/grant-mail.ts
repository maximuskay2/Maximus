// Notify a person when an admin grants Muse credit or a plan. Uses the same SMTP as sign-in mail.
import { creditGrantMailParts, type CreditGrantMailInput } from "../../shared/transactional-mail.ts";
import { SignInMailError, smtpOptions, type MailTransport } from "../sign-in-mail.ts";

export type GrantMailInput = CreditGrantMailInput & { email: string };

export interface GrantMailer {
  send(input: GrantMailInput): Promise<"sent" | "skipped">;
}

export function createGrantMail(options: {
  url: string;
  from?: string;
  appUrl?: string | null;
  transport?: MailTransport;
}): GrantMailer {
  let transport: Promise<MailTransport> | undefined = options.transport ? Promise.resolve(options.transport) : undefined;
  const from = (): string => {
    const named = options.from?.trim() || smtpOptions(options.url).auth?.user || "";
    if (!named.includes("@")) throw new SignInMailError("set MAXIMUS_SIGNIN_SMTP_FROM to the address grant notices come from");
    return named;
  };
  return {
    async send(input) {
      const email = input.email.trim().toLowerCase();
      if (!email.includes("@")) return "skipped";
      const parts = creditGrantMailParts({
        creditUsd: input.creditUsd,
        tokens: input.tokens,
        plan: input.plan,
        leftUsd: input.leftUsd,
        note: input.note,
        appUrl: input.appUrl ?? options.appUrl ?? null,
      });
      transport ??= import("nodemailer").then(({ createTransport }) => createTransport(smtpOptions(options.url)));
      await (await transport).sendMail({
        from: from(),
        to: email,
        subject: parts.subject,
        text: parts.text,
        html: parts.html,
      });
      return "sent";
    },
  };
}

/** Build a mailer from env, or null when SMTP is not configured. */
export function grantMailFromEnv(env: NodeJS.ProcessEnv = process.env): GrantMailer | null {
  const url = env.MAXIMUS_SIGNIN_SMTP_URL?.trim();
  if (!url) return null;
  const appUrl = env.MAXIMUS_PUBLIC_URL?.trim().replace(/\/+$/, "") || null;
  return createGrantMail({
    url,
    from: env.MAXIMUS_SIGNIN_SMTP_FROM,
    appUrl,
  });
}
