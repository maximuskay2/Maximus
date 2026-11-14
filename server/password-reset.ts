import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { normalizeAccountEmail, passwordLongEnough, validAccountEmail, type createPasswordAccounts } from "./password-accounts.ts";
import { SignInMailError, smtpOptions, type MailTransport } from "./sign-in-mail.ts";

const TOKEN_TTL_MS = 60 * 60_000;
const RESEND_MS = 30_000;
const MAX_PENDING = 1_000;

type Accounts = ReturnType<typeof createPasswordAccounts>;

export interface PasswordResetMail {
  request(email: string, linkOrigin?: string | null): Promise<"sent" | "tooSoon">;
  consume(token: string, password: string): { ok: true; email: string } | { ok: false; reason: "invalid" | "short-password" | "missing" };
}

const digest = (token: string) => createHash("sha256").update(token).digest();

/** One-time reset links mailed through MAXIMUS_SIGNIN_SMTP_URL. Missing accounts still look like a send. */
export function createPasswordResetMail(options: {
  accounts: Accounts;
  url: string;
  from?: string;
  origin: () => string | null;
  now?: () => number;
  transport?: MailTransport;
  /** Survives a restart so the link in the email still works. */
  file?: string;
}): PasswordResetMail {
  const now = options.now ?? Date.now;
  const pending = new Map<string, { email: string; hash: Buffer; sentAt: number }>();
  const lastSent = new Map<string, number>();
  let transport: Promise<MailTransport> | undefined = options.transport ? Promise.resolve(options.transport) : undefined;
  if (options.file && existsSync(options.file)) {
    try {
      const parsed = JSON.parse(readFileSync(options.file, "utf8")) as { pending?: { id?: unknown; email?: unknown; hash?: unknown; sentAt?: unknown }[] };
      const time = now();
      for (const row of parsed.pending ?? []) {
        if (typeof row.id !== "string" || typeof row.email !== "string" || typeof row.hash !== "string" || typeof row.sentAt !== "number") continue;
        if (time - row.sentAt >= TOKEN_TTL_MS) continue;
        pending.set(row.id, { email: row.email, hash: Buffer.from(row.hash, "hex"), sentAt: row.sentAt });
        const previous = lastSent.get(row.email) ?? 0;
        if (row.sentAt > previous) lastSent.set(row.email, row.sentAt);
      }
    } catch {
      // A damaged file starts empty. The next request rewrites it.
    }
  }
  const save = () => {
    if (!options.file) return;
    mkdirSync(dirname(options.file), { recursive: true, mode: 0o700 });
    const body = JSON.stringify({
      version: 1,
      pending: [...pending].map(([id, entry]) => ({ id, email: entry.email, hash: entry.hash.toString("hex"), sentAt: entry.sentAt })),
    });
    writeFileAtomic(options.file, body, { mode: 0o600 });
  };

  const from = (): string => {
    const named = options.from?.trim() || smtpOptions(options.url).auth?.user || "";
    if (!named.includes("@")) throw new SignInMailError("set MAXIMUS_SIGNIN_SMTP_FROM to the address password resets come from");
    return named;
  };

  const prune = () => {
    const time = now();
    for (const [key, entry] of pending) if (time - entry.sentAt >= TOKEN_TTL_MS) pending.delete(key);
  };

  return {
    async request(rawEmail, linkOrigin?: string | null) {
      const email = normalizeAccountEmail(rawEmail);
      if (!validAccountEmail(email)) return "sent";
      prune();
      const previous = lastSent.get(email) ?? 0;
      if (now() - previous < RESEND_MS) return "tooSoon";
      if (pending.size >= MAX_PENDING) return "tooSoon";
      lastSent.set(email, now());
      const account = options.accounts.list().find((row) => row.email === email);
      if (!account) return "sent";
      const origin = linkOrigin === undefined ? options.origin() : linkOrigin;
      if (!origin) return "sent";
      const token = randomBytes(32).toString("base64url");
      const id = randomBytes(16).toString("hex");
      pending.set(id, { email, hash: digest(token), sentAt: now() });
      save();
      const sender = from();
      transport ??= import("nodemailer").then(({ createTransport }) => createTransport(smtpOptions(options.url)));
      const link = `${origin}/reset?token=${encodeURIComponent(`${id}.${token}`)}`;
      try {
        await (await transport).sendMail({
          from: sender,
          to: email,
          subject: "Reset your Maximus password",
          text:
            `Use this link to choose a new Maximus password:\n\n${link}\n\n` +
            "It works once, for the next hour. If you did not ask for a reset, ignore this email.\n",
        });
      } catch (error) {
        pending.delete(id);
        if (previous) lastSent.set(email, previous);
        else lastSent.delete(email);
        save();
        throw error;
      }
      return "sent";
    },
    consume(rawToken, password) {
      if (!passwordLongEnough(password)) return { ok: false, reason: "short-password" };
      const match = /^([a-f0-9]{32})\.([A-Za-z0-9_-]{40,100})$/.exec(rawToken.trim());
      if (!match) return { ok: false, reason: "invalid" };
      prune();
      const id = match[1]!;
      const token = match[2]!;
      const entry = pending.get(id);
      if (!entry) return { ok: false, reason: "invalid" };
      const expected = entry.hash;
      const actual = digest(token);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: "invalid" };
      pending.delete(id);
      save();
      const changed = options.accounts.setPassword(entry.email, password);
      if (!changed.ok) return { ok: false, reason: "missing" };
      return { ok: true, email: changed.email };
    },
  };
}
