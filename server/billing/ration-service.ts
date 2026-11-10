// The ration wallet and the pooled Muse key. The key file is mode 0600 and is
// never returned on the admin API; callers see only whether it is set.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import type { PriceList } from "../prices.ts";
import {
  debitUsd, DEFAULT_RATION, hostedTier, outputTokensFor, parseRationProfile, rateFor, rationPreview, rationProblems, rationProfileSchema,
  type FreeIdentity, type RationPreview, type RationProfile, type TokenUse,
} from "./ration.ts";

const walletSchema = z.object({
  workspace: z.string(),
  tier: z.enum(["free", "byo", "starter", "plus", "pro"]),
  grantedUsd: z.number(),
  spentUsd: z.number(),
  period: z.string(),
  grantKey: z.string().nullable(),
  freeUsed: z.boolean(),
  day: z.string(),
  dayCount: z.number().int(),
  contributor: z.boolean().optional(),
  hour: z.string().optional(),
  hourCount: z.number().int().optional(),
});
type Wallet = z.infer<typeof walletSchema>;

const claimSchema = z.object({
  kind: z.enum(["email", "install"]),
  value: z.string().min(1).max(320),
  workspace: z.string().min(1).max(80),
});
type Claim = z.infer<typeof claimSchema>;

const walletFileSchema = z.object({
  version: z.literal(1),
  wallets: z.array(walletSchema).max(10_000),
  claims: z.array(claimSchema).max(20_000).optional(),
});

const poolSchema = z.object({
  version: z.literal(1),
  meta: z.string().max(4_000),
});

export interface RationRefusal {
  status: number;
  code: "spend_cap" | "model_locked" | "rate_limit";
  message: string;
}

export interface WalletPublic {
  tier: Wallet["tier"];
  grantedUsd: number;
  spentUsd: number;
  leftUsd: number;
  sparkTokens: number;
  contributorOffered: boolean;
  contributorAccepted: boolean;
  priceUsd: number;
  storePriceUsd: number;
}

export interface RationView {
  profile: RationProfile;
  preview: RationPreview;
  pool: { configured: boolean; last4: string };
  source: "stored" | "builtin";
}

const monthOf = (now: Date): string => now.toISOString().slice(0, 7);
const dayOf = (now: Date): string => now.toISOString().slice(0, 10);

function blankWallet(workspace: string, now: Date): Wallet {
  return {
    workspace, tier: "free", grantedUsd: 0, spentUsd: 0, period: "free", grantKey: null,
    freeUsed: false, day: dayOf(now), dayCount: 0,
  };
}

export class RationService {
  private readonly profileFile: string;
  private readonly walletFile: string;
  private readonly poolFile: string;
  private profile: RationProfile = DEFAULT_RATION;
  private stored = false;
  private wallets = new Map<string, Wallet>();
  private claims: Claim[] = [];
  private poolKey = "";

  constructor(options: { dataDir: string }) {
    const dir = join(options.dataDir, "billing");
    this.profileFile = join(dir, "ration.json");
    this.walletFile = join(dir, "wallets.json");
    this.poolFile = join(dir, "pool-key.json");
    this.load();
  }

  view(): RationView {
    return {
      profile: this.profile,
      preview: rationPreview(this.profile),
      pool: { configured: this.poolKey.length > 0, last4: this.poolKey.slice(-4) },
      source: this.stored ? "stored" : "builtin",
    };
  }

  profileNow(): RationProfile {
    return this.profile;
  }

  /** Null when saved. The previous profile is kept when the body is rejected. */
  saveProfile(raw: unknown): string | null {
    const parsed = parseRationProfile(raw);
    if (!parsed) {
      const shaped = rationProfileSchemaSafe(raw);
      return shaped ?? "rate profile is incomplete";
    }
    this.profile = parsed;
    this.stored = true;
    this.write(this.profileFile, JSON.stringify(parsed), 0o600);
    return null;
  }

  setPoolKey(key: string): void {
    this.poolKey = key.trim();
    this.write(this.poolFile, JSON.stringify({ version: 1, meta: this.poolKey }), 0o600);
  }

  /** Pooled Muse key, or null when the admin has not saved one. */
  metaKey(): string | null {
    return this.poolKey || null;
  }

  wallet(workspace: string, now = new Date()): Wallet {
    return this.wallets.get(workspace) ?? blankWallet(workspace, now);
  }

  /** One free grant per workspace, and one per verified email or install. A later paid period does not mint another. */
  ensureFree(workspace: string, now = new Date(), identity?: FreeIdentity): Wallet {
    const current = this.wallets.get(workspace);
    if (current?.freeUsed || (current && current.tier !== "free")) {
      if (this.noteIdentity(workspace, identity)) this.saveWallets();
      return current ?? blankWallet(workspace, now);
    }
    const taken = this.identityTaken(workspace, identity);
    const next: Wallet = {
      ...(current ?? blankWallet(workspace, now)),
      tier: "free",
      grantedUsd: taken ? 0 : this.profile.freeGrantUsd,
      spentUsd: 0,
      period: "free",
      freeUsed: true,
    };
    this.wallets.set(workspace, next);
    this.noteIdentity(workspace, identity);
    this.saveWallets();
    return next;
  }

  /** Contributor Spark only after the person accepts. Meta may train on those turns. */
  acceptContributor(workspace: string, accept: boolean, now = new Date(), identity?: FreeIdentity): Wallet {
    const wallet = this.ensureFree(workspace, now, identity);
    if (wallet.tier !== "free") return wallet;
    wallet.contributor = accept;
    this.wallets.set(workspace, wallet);
    this.saveWallets();
    return wallet;
  }

  /** What Usage shows. Opens the free grant the first time this workspace is read. */
  walletView(workspace: string, now = new Date(), identity?: FreeIdentity): WalletPublic {
    const wallet = this.ensureFree(workspace, now, identity);
    const left = Math.max(0, Math.round((this.limit(wallet) - wallet.spentUsd) * 1_000_000) / 1_000_000);
    const sparkId = wallet.tier === "free" && wallet.contributor === true && this.profile.contributorFree
      ? "muse-spark-1.3-contributor"
      : "muse-spark-1.3";
    const spark = rateFor(this.profile, sparkId);
    const hosted = hostedTier(this.profile, wallet.tier);
    const priceUsd = wallet.tier === "byo" ? this.profile.byoPriceUsd : hosted?.priceUsd ?? 0;
    const storePriceUsd = wallet.tier === "byo" ? this.profile.byoStorePriceUsd : hosted?.storePriceUsd ?? 0;
    return {
      tier: wallet.tier,
      grantedUsd: wallet.grantedUsd,
      spentUsd: wallet.spentUsd,
      leftUsd: left,
      sparkTokens: spark ? outputTokensFor(left, spark.outputPerMillion) : 0,
      contributorOffered: this.profile.contributorFree,
      contributorAccepted: wallet.contributor === true,
      priceUsd,
      storePriceUsd,
    };
  }

  /**
   * Bring-your-own turns do not spend the pooled key. They still count
   * against the hour and day caps so a $9 seat cannot pin the CPU.
   */
  admitByo(workspace: string, now = new Date()): RationRefusal | null {
    const wallet = this.wallets.get(workspace);
    if (!wallet || wallet.tier !== "byo") return null;
    const day = dayOf(now);
    const hourKey = now.toISOString().slice(0, 13);
    const dayCount = wallet.day === day ? wallet.dayCount : 0;
    const hourCount = wallet.hour === hourKey ? wallet.hourCount ?? 0 : 0;
    if (hourCount >= this.profile.byoRequestsPerHour || dayCount >= this.profile.byoRequestsPerDay) {
      return {
        status: 429,
        code: "rate_limit",
        message: `Your model plan allows ${this.profile.byoRequestsPerHour} requests an hour and ${this.profile.byoRequestsPerDay} a day.`,
      };
    }
    wallet.day = day;
    wallet.dayCount = dayCount + 1;
    wallet.hour = hourKey;
    wallet.hourCount = hourCount + 1;
    this.wallets.set(workspace, wallet);
    this.saveWallets();
    return null;
  }

  /** Image and web search on a paid hosted plan. The free grant cannot buy them. Bring-your-own uses that person's provider, so this wallet stays put. */
  debitAddon(workspace: string, amountUsd: number): RationRefusal | null {
    const wallet = this.wallets.get(workspace);
    if (wallet?.tier === "byo") return null;
    if (!wallet || wallet.tier === "free") {
      return { status: 403, code: "model_locked", message: "Image and web search stay off the free grant." };
    }
    const cost = Math.round(Math.max(0, amountUsd) * 1_000_000) / 1_000_000;
    if (cost === 0) return null;
    if (wallet.spentUsd + cost > this.limit(wallet)) return this.capRefusal(wallet);
    wallet.spentUsd = Math.round((wallet.spentUsd + cost) * 1_000_000) / 1_000_000;
    this.wallets.set(workspace, wallet);
    this.saveWallets();
    return null;
  }

  /** Sell list for the margin report when overage is on. The wallet still debits provider cost. */
  overageSell(): PriceList | null {
    if (!this.profile.overageEnabled) return null;
    const multiplier = this.profile.overageMultiplier;
    const list: PriceList = {};
    for (const rate of this.profile.rates) {
      list[rate.id] = {
        inputPerMillion: rate.inputPerMillion * multiplier,
        cachedInputPerMillion: rate.cachedInputPerMillion * multiplier,
        outputPerMillion: rate.outputPerMillion * multiplier,
      };
    }
    return list;
  }

  /**
   * Invoice paid: reset the hosted ration for this period. The same provider
   * event id is a no-op, so a replayed webhook cannot grant the month twice.
   */
  grantPaid(workspace: string, plan: string, eventKey: string, now = new Date()): Wallet | null {
    const current = this.wallets.get(workspace) ?? blankWallet(workspace, now);
    if (current.grantKey === eventKey) return current;
    const fresh = { day: dayOf(now), dayCount: 0, hour: "", hourCount: 0 };
    if (plan === "byo") {
      const next: Wallet = { ...current, ...fresh, tier: "byo", grantedUsd: 0, spentUsd: 0, period: monthOf(now), grantKey: eventKey, freeUsed: true };
      this.wallets.set(workspace, next);
      this.saveWallets();
      return next;
    }
    const tier = hostedTier(this.profile, plan);
    if (!tier) return null;
    const next: Wallet = {
      ...current,
      ...fresh,
      tier: tier.id,
      grantedUsd: tier.includedCostUsd,
      spentUsd: 0,
      period: monthOf(now),
      grantKey: eventKey,
      freeUsed: true,
    };
    this.wallets.set(workspace, next);
    this.saveWallets();
    return next;
  }

  preflight(workspace: string, model: string, rawBody: string, now = new Date()): RationRefusal | null {
    const wallet = this.ensureFree(workspace, now);
    const allowed = this.allowedModel(wallet, model);
    if (!allowed) {
      return { status: 403, code: "model_locked", message: "This model is outside the current plan." };
    }
    const day = dayOf(now);
    const dayCount = wallet.day === day ? wallet.dayCount : 0;
    if (wallet.tier === "free" && dayCount >= this.profile.freeDailyRequests) {
      return { status: 429, code: "rate_limit", message: "The free Muse grant allows a limited number of requests each day." };
    }
    const inputTokens = Math.ceil(rawBody.length / 4);
    const rate = rateFor(this.profile, model, inputTokens);
    if (!rate) return { status: 403, code: "model_locked", message: "This model has no admin rate." };
    const reserve = wallet.tier === "free" ? this.profile.freeOutputReserve : this.profile.freeOutputReserve;
    const estimate = debitUsd({ freshInput: inputTokens, cachedInput: 0, output: reserve }, rate);
    if (wallet.spentUsd + estimate > this.limit(wallet)) {
      return this.capRefusal(wallet);
    }
    return null;
  }

  debit(workspace: string, model: string, use: TokenUse, now = new Date()): RationRefusal | null {
    const wallet = this.wallets.get(workspace);
    if (!wallet || wallet.tier === "byo") return null;
    const rate = rateFor(this.profile, model, use.freshInput + use.cachedInput);
    if (!rate) return { status: 403, code: "model_locked", message: "This model has no admin rate." };
    const cost = debitUsd(use, rate);
    if (wallet.spentUsd + cost > this.limit(wallet)) return this.capRefusal(wallet);
    const day = dayOf(now);
    wallet.spentUsd = Math.round((wallet.spentUsd + cost) * 1_000_000) / 1_000_000;
    wallet.dayCount = wallet.day === day ? wallet.dayCount + 1 : 1;
    wallet.day = day;
    this.wallets.set(workspace, wallet);
    this.saveWallets();
    return null;
  }

  private allowedModel(wallet: Wallet, model: string): boolean {
    if (wallet.tier === "byo") return false;
    if (wallet.tier === "free") {
      const contributor = this.profile.contributorFree && wallet.contributor === true;
      return model === (contributor ? "muse-spark-1.3-contributor" : "muse-spark-1.3");
    }
    const tier = hostedTier(this.profile, wallet.tier);
    if (!tier) return false;
    return tier.models.includes(model) || (model === "muse-ember-1.0-long" && tier.models.includes("muse-ember-1.0"));
  }

  private limit(wallet: Wallet): number {
    if (wallet.tier === "free" || wallet.tier === "byo" || !this.profile.overageEnabled) return wallet.grantedUsd;
    return wallet.grantedUsd * this.profile.overageCapMultiplier;
  }

  private capRefusal(wallet: Wallet): RationRefusal {
    const left = Math.max(0, this.limit(wallet) - wallet.spentUsd);
    return {
      status: 409,
      code: "spend_cap",
      message: `this workspace has $${left.toFixed(4)} of Muse ration left — an admin can raise it under Rates`,
    };
  }

  private load(): void {
    const profile = readJson(this.profileFile);
    const parsed = parseRationProfile(profile);
    if (parsed) {
      this.profile = parsed;
      this.stored = true;
    }
    const wallets = walletFileSchema.safeParse(readJson(this.walletFile));
    if (wallets.success) {
      for (const wallet of wallets.data.wallets) this.wallets.set(wallet.workspace, wallet);
      this.claims = wallets.data.claims ?? [];
    }
    const pool = poolSchema.safeParse(readJson(this.poolFile));
    if (pool.success) this.poolKey = pool.data.meta;
  }

  private saveWallets(): void {
    this.write(this.walletFile, JSON.stringify({ version: 1, wallets: [...this.wallets.values()], claims: this.claims }), 0o600);
  }

  private noteIdentity(workspace: string, identity?: FreeIdentity): boolean {
    const email = identity?.email?.trim().toLowerCase() ?? "";
    const install = identity?.installId?.trim() ?? "";
    let changed = false;
    for (const [kind, value] of [["email", email], ["install", install]] as const) {
      if (!value || value.length > 320) continue;
      if (this.claims.some((claim) => claim.kind === kind && claim.value === value && claim.workspace === workspace)) continue;
      this.claims.push({ kind, value, workspace });
      changed = true;
    }
    return changed;
  }

  private identityTaken(workspace: string, identity?: FreeIdentity): boolean {
    const email = identity?.email?.trim().toLowerCase() ?? "";
    const install = identity?.installId?.trim() ?? "";
    return this.claims.some((claim) => claim.workspace !== workspace && (
      (email !== "" && claim.kind === "email" && claim.value === email)
      || (install !== "" && claim.kind === "install" && claim.value === install)
    ));
  }

  private write(file: string, body: string, mode: number): void {
    mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
    writeFileAtomic(file, body, { mode });
  }
}

function readJson(file: string): unknown {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

let live: RationService | null = null;

export function bindLiveRation(service: RationService): void {
  live = service;
}

export function liveRation(): RationService | null {
  return live;
}

function rationProfileSchemaSafe(raw: unknown): string | null {
  const parsed = rationProfileSchema.safeParse(raw);
  if (!parsed.success) return "rate profile is incomplete";
  return rationProblems(parsed.data);
}
