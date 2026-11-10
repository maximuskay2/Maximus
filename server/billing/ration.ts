// Admin-edited Muse ration: provider rates, the free grant, bring-your-own
// seat, and hosted prices. Amounts are USD. A save that would bill a full
// month of included Muse for more than half the seat price is rejected.
import { z } from "zod";

const money = z.number().finite().min(0).max(1_000_000);
const rateSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,80}$/),
  inputPerMillion: money,
  cachedInputPerMillion: money,
  outputPerMillion: money,
});
export type ModelRate = z.infer<typeof rateSchema>;

const tierSchema = z.object({
  id: z.enum(["starter", "plus", "pro"]),
  priceUsd: money,
  storePriceUsd: money,
  includedCostUsd: money,
  hardCapUsd: money,
  models: z.array(z.string().min(1).max(80)).min(1).max(8),
});
export type HostedTier = z.infer<typeof tierSchema>;

export const rationProfileSchema = z.object({
  version: z.literal(1),
  rates: z.array(rateSchema).min(1).max(16),
  freeGrantUsd: money,
  /** Free turns use the contributor Spark rate. Meta may train on that content. */
  contributorFree: z.boolean(),
  freeDailyRequests: z.number().int().min(1).max(10_000),
  freeOutputReserve: z.number().int().min(1).max(200_000),
  byoPriceUsd: money,
  byoStorePriceUsd: money,
  byoRequestsPerHour: z.number().int().min(1).max(100_000),
  byoRequestsPerDay: z.number().int().min(1).max(1_000_000),
  overageEnabled: z.boolean(),
  overageMultiplier: z.number().finite().min(1).max(10),
  overageCapMultiplier: z.number().finite().min(1).max(10),
  hosted: z.array(tierSchema).length(3),
});
export type RationProfile = z.infer<typeof rationProfileSchema>;

export const DEFAULT_RATION: RationProfile = {
  version: 1,
  rates: [
    { id: "muse-spark-1.3-contributor", inputPerMillion: 0.1, cachedInputPerMillion: 0.002, outputPerMillion: 0.2 },
    { id: "muse-spark-1.3", inputPerMillion: 1.25, cachedInputPerMillion: 0.15, outputPerMillion: 4.25 },
    { id: "muse-ember-1.0", inputPerMillion: 0.1, cachedInputPerMillion: 0.004, outputPerMillion: 0.5 },
    { id: "muse-ember-1.0-long", inputPerMillion: 0.3, cachedInputPerMillion: 0.012, outputPerMillion: 1.5 },
    { id: "muse-wonder-1.0", inputPerMillion: 4, cachedInputPerMillion: 0.2, outputPerMillion: 20 },
  ],
  freeGrantUsd: 0.012,
  contributorFree: true,
  freeDailyRequests: 20,
  freeOutputReserve: 2_000,
  byoPriceUsd: 9,
  byoStorePriceUsd: 12,
  byoRequestsPerHour: 60,
  byoRequestsPerDay: 2_000,
  overageEnabled: false,
  overageMultiplier: 1.6,
  overageCapMultiplier: 2,
  hosted: [
    { id: "starter", priceUsd: 19, storePriceUsd: 24, includedCostUsd: 8, hardCapUsd: 8, models: ["muse-spark-1.3"] },
    { id: "plus", priceUsd: 49, storePriceUsd: 59, includedCostUsd: 22, hardCapUsd: 22, models: ["muse-spark-1.3", "muse-ember-1.0"] },
    { id: "pro", priceUsd: 99, storePriceUsd: 119, includedCostUsd: 40, hardCapUsd: 40, models: ["muse-spark-1.3", "muse-ember-1.0", "muse-wonder-1.0"] },
  ],
};

const usd = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

export function outputTokensFor(grantUsd: number, outputPerMillion: number): number {
  if (outputPerMillion <= 0) return 0;
  return Math.floor((grantUsd / outputPerMillion) * 1_000_000);
}

export interface TokenUse {
  freshInput: number;
  cachedInput: number;
  output: number;
}

/** Provider cost of one turn. Fresh input and cached input are separate counts. */
export function debitUsd(use: TokenUse, rate: ModelRate): number {
  const fresh = Math.max(0, use.freshInput);
  const cached = Math.max(0, use.cachedInput);
  const output = Math.max(0, use.output);
  return usd((fresh * rate.inputPerMillion + cached * rate.cachedInputPerMillion + output * rate.outputPerMillion) / 1_000_000);
}

export function rateFor(profile: RationProfile, model: string, inputTokens = 0): ModelRate | null {
  const id = model === "muse-ember-1.0" && inputTokens > 200_000 ? "muse-ember-1.0-long" : model;
  return profile.rates.find((rate) => rate.id === id) ?? profile.rates.find((rate) => rate.id === model) ?? null;
}

export function hostedTier(profile: RationProfile, id: string): HostedTier | null {
  return profile.hosted.find((tier) => tier.id === id) ?? null;
}

export interface RationPreview {
  freeOutputTokens: number;
  starterOutputTokens: number;
  plusOutputTokens: number;
  proOutputTokens: number;
}

export function rationPreview(profile: RationProfile): RationPreview {
  const freeRate = rateFor(profile, profile.contributorFree ? "muse-spark-1.3-contributor" : "muse-spark-1.3");
  const spark = rateFor(profile, "muse-spark-1.3");
  const tokens = (grant: number, rate: ModelRate | null): number => (rate ? outputTokensFor(grant, rate.outputPerMillion) : 0);
  return {
    freeOutputTokens: tokens(profile.freeGrantUsd, freeRate),
    starterOutputTokens: tokens(hostedTier(profile, "starter")?.includedCostUsd ?? 0, spark),
    plusOutputTokens: tokens(hostedTier(profile, "plus")?.includedCostUsd ?? 0, spark),
    proOutputTokens: tokens(hostedTier(profile, "pro")?.includedCostUsd ?? 0, spark),
  };
}

/** Null when the profile can be saved. */
export function rationProblems(profile: RationProfile): string | null {
  const starter = hostedTier(profile, "starter");
  const plus = hostedTier(profile, "plus");
  const pro = hostedTier(profile, "pro");
  if (!starter || !plus || !pro) return "starter, plus, and pro are required";
  if (new Set(profile.hosted.map((tier) => tier.id)).size !== 3) return "hosted tiers must be starter, plus, and pro";
  for (const tier of profile.hosted) {
    if (tier.includedCostUsd > tier.priceUsd * 0.5) {
      return `${tier.id} included Muse cost must be at most half the monthly price`;
    }
    if (tier.hardCapUsd < tier.includedCostUsd) {
      return `${tier.id} hard cap must be at least the included Muse cost`;
    }
    for (const model of tier.models) {
      if (!rateFor(profile, model)) return `${tier.id} lists ${model}, which has no rate`;
    }
  }
  if (profile.byoPriceUsd > starter.priceUsd - 8) {
    return "bring-your-own price must be at least $8 below Starter";
  }
  if (profile.overageEnabled && profile.overageMultiplier < 1.4) {
    return "overage multiplier must be at least 1.4";
  }
  if (!rateFor(profile, "muse-spark-1.3")) return "muse-spark-1.3 needs a rate";
  if (profile.contributorFree && !rateFor(profile, "muse-spark-1.3-contributor")) {
    return "contributor free grant needs the contributor Spark rate";
  }
  return null;
}

export interface RationPlanSeed {
  id: string;
  baseUsd: number;
  allowanceUsd: number;
  hardCapUsd: number;
  entitlements: string[];
  display: { name: string; blurb: string; features: string[] };
}

/** Plan rows the ration editor writes so checkout and the allowance use the same numbers. */
export function plansFromRation(profile: RationProfile): RationPlanSeed[] {
  return [
    {
      id: "free",
      baseUsd: 0,
      allowanceUsd: profile.freeGrantUsd,
      hardCapUsd: profile.freeGrantUsd,
      entitlements: [],
      display: {
        name: "Free",
        blurb: "A one-time Muse grant on our key.",
        features: ["Spark", "Once per account"],
      },
    },
    {
      id: "byo",
      baseUsd: profile.byoPriceUsd,
      allowanceUsd: 0,
      hardCapUsd: 0,
      entitlements: ["billing"],
      display: {
        name: "Your model",
        blurb: "Bring your own LLM key. The monthly fee is for the app.",
        features: ["Web, desktop, and phone", "Your provider bills the tokens"],
      },
    },
    ...profile.hosted.map((tier) => ({
      id: tier.id,
      baseUsd: tier.priceUsd,
      allowanceUsd: tier.includedCostUsd,
      hardCapUsd: profile.overageEnabled ? tier.includedCostUsd * profile.overageCapMultiplier : tier.hardCapUsd,
      entitlements: ["billing", "gateway"],
      display: {
        name: tier.id === "starter" ? "Starter" : tier.id === "plus" ? "Plus" : "Pro",
        blurb: `Includes $${tier.includedCostUsd} of Muse on our key.`,
        features: tier.models.map((model) => model),
      },
    })),
  ];
}

export interface FreeIdentity {
  email?: string;
  installId?: string;
}

/** Same id checkout uses. A server with no workspace configured bills `local`. */
export function rationWorkspace(env: NodeJS.ProcessEnv = process.env): string {
  const id = env.MAXIMUS_ADMIN_WORKSPACE?.trim() ?? "";
  return /^[a-z][a-z0-9-]{1,30}$/.test(id) ? id : "local";
}

export function parseRationProfile(raw: unknown): RationProfile | null {
  const parsed = rationProfileSchema.safeParse(raw);
  if (!parsed.success) return null;
  return rationProblems(parsed.data) ? null : parsed.data;
}
