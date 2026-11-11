// Admin switch for Paystack. Nigeria is the pilot: a person there sees the
// Naira equivalent of the catalog's dollar price and checks out with Paystack.
// The rate is the admin's, saved on this server, not a live market quote.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";

export interface PaymentSettings {
  paystackEnabled: boolean;
  ngnPerUsd: number;
}

export const DEFAULT_PAYMENTS: PaymentSettings = {
  paystackEnabled: false,
  ngnPerUsd: 1600,
};

const fileSchema = z.object({
  version: z.literal(1),
  paystackEnabled: z.boolean(),
  ngnPerUsd: z.number().finite().positive().max(1_000_000),
});

export function nairaFromUsd(usd: number, ngnPerUsd: number): number {
  if (!(usd > 0) || !(ngnPerUsd > 0)) return 0;
  return Math.round(usd * ngnPerUsd);
}

/** Paystack charges in kobo. */
export function koboFromUsd(usd: number, ngnPerUsd: number): number {
  return nairaFromUsd(usd, ngnPerUsd) * 100;
}

/** Cloudflare's country header wins. Without it, Africa/Lagos or the WAT abbreviation Dart's DateTime.timeZoneName reports in Nigeria counts. */
export function nigeriaFromSignals(input: { countryHeader?: string | null; timeZone?: string | null }): boolean {
  const country = input.countryHeader?.trim().toUpperCase();
  if (country) return country === "NG";
  const zone = input.timeZone?.trim();
  return zone === "Africa/Lagos" || zone === "WAT" || zone === "West Africa Standard Time";
}

export class PaymentStore {
  private readonly dataDir: string;
  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private file(): string {
    return join(this.dataDir, "billing", "payments.json");
  }

  read(): PaymentSettings {
    const file = this.file();
    if (!existsSync(file)) return { ...DEFAULT_PAYMENTS };
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")) as unknown);
      if (!parsed.success) return { ...DEFAULT_PAYMENTS };
      return { paystackEnabled: parsed.data.paystackEnabled, ngnPerUsd: parsed.data.ngnPerUsd };
    } catch {
      return { ...DEFAULT_PAYMENTS };
    }
  }

  save(next: PaymentSettings): string | null {
    const parsed = fileSchema.safeParse({ version: 1, ...next });
    if (!parsed.success) return "Naira per dollar must be a positive number";
    const dir = join(this.dataDir, "billing");
    mkdirSync(dir, { recursive: true });
    writeFileAtomic(this.file(), `${JSON.stringify({ version: 1, paystackEnabled: parsed.data.paystackEnabled, ngnPerUsd: parsed.data.ngnPerUsd })}\n`, { mode: 0o600 });
    return null;
  }
}
