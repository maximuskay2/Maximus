import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import { canonicalGrantEmail } from "./grant-identity.ts";

export const ACCOUNT_CHOICES = ["free", "byo", "muse"] as const;
export type AccountChoice = (typeof ACCOUNT_CHOICES)[number];

const rowSchema = z.object({
  email: z.string().min(3).max(320),
  choice: z.enum(ACCOUNT_CHOICES),
  at: z.number(),
});

const fileSchema = z.object({
  version: z.literal(1),
  plans: z.array(rowSchema).max(20_000),
});

/** The plan an email already accepted. A later device reads this instead of asking again. */
export class AccountPlans {
  private readonly file: string;
  private readonly rows = new Map<string, z.infer<typeof rowSchema>>();

  constructor(dataDir: string) {
    this.file = join(dataDir, "billing", "account-plans.json");
    this.load();
  }

  get(email: string): AccountChoice | null {
    return this.rows.get(normalize(email))?.choice ?? null;
  }

  /** Free never replaces a paid choice. Paying replaces free. The same choice is a no-op. */
  choose(email: string, choice: AccountChoice, now = Date.now()): AccountChoice {
    const key = normalize(email);
    if (!key) return choice;
    const current = this.rows.get(key);
    const next = current && current.choice !== "free" && choice === "free" ? current.choice : choice;
    if (current?.choice === next) return next;
    this.rows.set(key, { email: key, choice: next, at: now });
    this.save();
    return next;
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(this.file, "utf8")) as unknown);
      if (!parsed.success) return;
      for (const row of parsed.data.plans) this.rows.set(row.email, row);
    } catch {
      // A damaged file starts empty. The next choice rewrites it.
    }
  }

  private save(): void {
    mkdirSync(join(this.file, ".."), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, JSON.stringify({ version: 1, plans: [...this.rows.values()] }), { mode: 0o600 });
  }
}

function normalize(email: string): string {
  return canonicalGrantEmail(email);
}
