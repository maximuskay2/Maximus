// Admin switches for payment gateways, plus operator-pasted secrets stored
// under the data dir (mode 0600). Paystack (Nigeria pilot) and Bachs are
// independent toggles; Stripe remains the default dollar path when neither
// applies. Env secrets still win when set.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import type { CheckoutSecrets } from "./checkout.ts";
import type { BillingWebhookSecrets } from "./http.ts";

export interface PaymentSettings {
  paystackEnabled: boolean;
  bachsEnabled: boolean;
  ngnPerUsd: number;
}

export interface GatewaySecretStatus {
  configured: boolean;
  last4: string;
}

export interface PaymentAdminView extends PaymentSettings {
  bachsApiBase: string;
  secrets: {
    paystackSecretKey: GatewaySecretStatus;
    bachsApiKey: GatewaySecretStatus;
    bachsWebhookSecret: GatewaySecretStatus;
    stripeSecretKey: GatewaySecretStatus;
  };
}

export interface GatewaySecrets {
  paystackSecretKey: string;
  bachsApiKey: string;
  bachsWebhookSecret: string;
  stripeSecretKey: string;
  bachsApiBase: string;
}

export const DEFAULT_PAYMENTS: PaymentSettings = {
  paystackEnabled: false,
  bachsEnabled: false,
  ngnPerUsd: 1600,
};

const EMPTY_SECRETS: GatewaySecrets = {
  paystackSecretKey: "",
  bachsApiKey: "",
  bachsWebhookSecret: "",
  stripeSecretKey: "",
  bachsApiBase: "",
};

const fileSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  paystackEnabled: z.boolean(),
  bachsEnabled: z.boolean().default(false),
  ngnPerUsd: z.number().finite().positive().max(1_000_000),
});

const secretsSchema = z.object({
  version: z.literal(1),
  paystackSecretKey: z.string().max(512).default(""),
  bachsApiKey: z.string().max(512).default(""),
  bachsWebhookSecret: z.string().max(512).default(""),
  stripeSecretKey: z.string().max(512).default(""),
  bachsApiBase: z.string().max(320).default(""),
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

function statusOf(value: string): GatewaySecretStatus {
  const trimmed = value.trim();
  return { configured: trimmed.length > 0, last4: trimmed.length > 0 ? trimmed.slice(-4) : "" };
}

export function mergeCheckoutSecrets(envSecrets: CheckoutSecrets, stored: GatewaySecrets): CheckoutSecrets {
  return {
    stripeSecretKey: envSecrets.stripeSecretKey || stored.stripeSecretKey || undefined,
    paystackSecretKey: envSecrets.paystackSecretKey || stored.paystackSecretKey || undefined,
    bachsApiKey: envSecrets.bachsApiKey || stored.bachsApiKey || undefined,
    bachsApiBase: envSecrets.bachsApiBase || stored.bachsApiBase || undefined,
  };
}

export function mergeWebhookSecrets(envSecrets: BillingWebhookSecrets, stored: GatewaySecrets): BillingWebhookSecrets {
  return {
    stripeWebhookSecret: envSecrets.stripeWebhookSecret,
    paystackSecretKey: envSecrets.paystackSecretKey || stored.paystackSecretKey || undefined,
    bachsWebhookSecret: envSecrets.bachsWebhookSecret || stored.bachsWebhookSecret || undefined,
  };
}

export class PaymentStore {
  private readonly dataDir: string;
  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private file(): string {
    return join(this.dataDir, "billing", "payments.json");
  }

  private secretsFile(): string {
    return join(this.dataDir, "billing", "gateway-secrets.json");
  }

  read(): PaymentSettings {
    const file = this.file();
    if (!existsSync(file)) return { ...DEFAULT_PAYMENTS };
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")) as unknown);
      if (!parsed.success) return { ...DEFAULT_PAYMENTS };
      return {
        paystackEnabled: parsed.data.paystackEnabled,
        bachsEnabled: parsed.data.bachsEnabled,
        ngnPerUsd: parsed.data.ngnPerUsd,
      };
    } catch {
      return { ...DEFAULT_PAYMENTS };
    }
  }

  readSecrets(): GatewaySecrets {
    const file = this.secretsFile();
    if (!existsSync(file)) return { ...EMPTY_SECRETS };
    try {
      const parsed = secretsSchema.safeParse(JSON.parse(readFileSync(file, "utf8")) as unknown);
      if (!parsed.success) return { ...EMPTY_SECRETS };
      return {
        paystackSecretKey: parsed.data.paystackSecretKey,
        bachsApiKey: parsed.data.bachsApiKey,
        bachsWebhookSecret: parsed.data.bachsWebhookSecret,
        stripeSecretKey: parsed.data.stripeSecretKey,
        bachsApiBase: parsed.data.bachsApiBase,
      };
    } catch {
      return { ...EMPTY_SECRETS };
    }
  }

  adminView(): PaymentAdminView {
    const settings = this.read();
    const secrets = this.readSecrets();
    return {
      ...settings,
      bachsApiBase: secrets.bachsApiBase,
      secrets: {
        paystackSecretKey: statusOf(secrets.paystackSecretKey),
        bachsApiKey: statusOf(secrets.bachsApiKey),
        bachsWebhookSecret: statusOf(secrets.bachsWebhookSecret),
        stripeSecretKey: statusOf(secrets.stripeSecretKey),
      },
    };
  }

  save(next: PaymentSettings): string | null {
    const parsed = fileSchema.safeParse({ version: 2, ...next });
    if (!parsed.success) return "Naira per dollar must be a positive number";
    const dir = join(this.dataDir, "billing");
    mkdirSync(dir, { recursive: true });
    writeFileAtomic(this.file(), `${JSON.stringify({
      version: 2,
      paystackEnabled: parsed.data.paystackEnabled,
      bachsEnabled: parsed.data.bachsEnabled,
      ngnPerUsd: parsed.data.ngnPerUsd,
    })}\n`, { mode: 0o600 });
    return null;
  }

  /**
   * Optional secret fields: omit to leave unchanged, empty string to clear,
   * non-empty to replace. `bachsApiBase` is a public API origin (sandbox or live).
   */
  saveSecrets(patch: Partial<Record<keyof GatewaySecrets, string | undefined>>): string | null {
    const current = this.readSecrets();
    const next: GatewaySecrets = { ...current };
    for (const key of Object.keys(EMPTY_SECRETS) as Array<keyof GatewaySecrets>) {
      if (!Object.hasOwn(patch, key)) continue;
      const value = patch[key];
      if (value === undefined) continue;
      next[key] = value.trim();
    }
    if (next.bachsApiBase) {
      try {
        const url = new URL(next.bachsApiBase);
        if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
          return "Bachs API base must be an https origin such as https://sandbox-api.bachs.io";
        }
        next.bachsApiBase = url.origin;
      } catch {
        return "Bachs API base must be an https origin such as https://sandbox-api.bachs.io";
      }
    }
    const dir = join(this.dataDir, "billing");
    mkdirSync(dir, { recursive: true });
    writeFileAtomic(this.secretsFile(), `${JSON.stringify({ version: 1, ...next })}\n`, { mode: 0o600 });
    return null;
  }
}
