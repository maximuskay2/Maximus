// Hosted entitlement sync (roadmap Track 3): a portal-managed workspace
// pulls its entitlements + provider policy from the control plane, degrades
// grace-to-free-tier without a restart, and reports a banner + startup log in
// the same shape as editionStatus/licenseWarning. A contract mismatch throws
// ContractMismatchError (409/503 upstream), never a silent downgrade; an
// outage keeps the last-good cache and marks the view offline.
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { KNOWN_ENTITLEMENTS } from "./enterprise.ts";
import {
  MAXIMUS_CONTRACT_HEADER,
  MAXIMUS_CONTRACT_MISMATCH,
  MAXIMUS_CONTRACT_VERSION,
  maximusContractCompatible,
} from "./maximus-contract.ts";
import { parseWorkspacePolicy, type WorkspacePolicy } from "./switchboard.ts";

export const ENTITLEMENT_GRACE_MS = 7 * 24 * 60 * 60_000;
export const ENTITLEMENT_SYNC_TIMEOUT_MS = 5_000;
const CACHE_VERSION = 1;

export interface SyncedBanner {
  kind: "grace" | "suspended" | "offline";
  title: string;
  body: string;
}

export interface SyncedEntitlements {
  workspace: string;
  plan: string;
  /** Carried ids from the control plane (may include unshipped ids). */
  carried: string[];
  /** Granted ids: known ids only, sorted. */
  granted: string[];
  allowance: number | null;
  status: "active" | "grace" | "suspended";
  graceEndsAt: number | null;
  banner: SyncedBanner | null;
  syncedAt: number;
  offline: boolean;
}

export class ContractMismatchError extends Error {
  readonly status = 409;
  readonly code = MAXIMUS_CONTRACT_MISMATCH;
  constructor() {
    super("Admin and workspace runtime versions are incompatible. Ask your administrator to update the deployment.");
    this.name = "ContractMismatchError";
  }
}

const entitlementsPayload = z.object({
  entitlements: z.object({
    workspace: z.string(),
    plan: z.string(),
    entitlements: z.array(z.string()),
    allowance: z.number().nullable(),
    status: z.enum(["active", "grace", "suspended"]),
    graceEndsAt: z.number().nullable(),
  }),
});

const providersPayload = z.object({
  workspace: z.string(),
  providers: z.record(z.string(), z.unknown()),
});

const cacheSchema = z.object({
  version: z.literal(CACHE_VERSION),
  workspace: z.string(),
  entitlements: entitlementsPayload.shape.entitlements,
  providers: z.record(z.string(), z.unknown()),
  savedAt: z.number(),
});

export interface EntitlementSyncOptions {
  adminOrigin: string;
  workspace: string;
  token?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Persisted last-good cache so a restart during an outage keeps grace state. */
  cacheFile?: string;
  timeoutMs?: number;
}

export function grantedFromCarried(carried: readonly string[]): string[] {
  return [...new Set(carried.filter((id) => (KNOWN_ENTITLEMENTS as readonly string[]).includes(id)))].sort();
}

export class EntitlementSync {
  private readonly adminOrigin: string;
  private readonly workspace: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cacheFile: string | undefined;
  private readonly timeoutMs: number;
  private entitlements: z.infer<typeof entitlementsPayload.shape.entitlements> | null = null;
  private providers: Record<string, unknown> = {};
  private syncedAt = 0;
  private offline = false;
  private offlineReason = "";

  constructor(options: EntitlementSyncOptions) {
    this.adminOrigin = options.adminOrigin.replace(/\/$/, "");
    this.workspace = options.workspace;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.cacheFile = options.cacheFile;
    this.timeoutMs = options.timeoutMs ?? ENTITLEMENT_SYNC_TIMEOUT_MS;
    this.loadCache();
  }

  private loadCache(): void {
    if (!this.cacheFile || !existsSync(this.cacheFile)) return;
    try {
      const parsed = cacheSchema.safeParse(JSON.parse(readFileSync(this.cacheFile, "utf8")));
      if (!parsed.success || parsed.data.workspace !== this.workspace) return;
      this.entitlements = parsed.data.entitlements;
      this.providers = parsed.data.providers;
      this.syncedAt = parsed.data.savedAt;
      this.offline = true;
      this.offlineReason = "restored from cache";
    } catch {
      this.entitlements = null;
    }
  }

  private saveCache(): void {
    if (!this.cacheFile || !this.entitlements) return;
    try {
      writeFileAtomic(this.cacheFile, JSON.stringify({
        version: CACHE_VERSION,
        workspace: this.workspace,
        entitlements: this.entitlements,
        providers: this.providers,
        savedAt: this.syncedAt,
      }), { mode: 0o600 });
    } catch {
      // Best effort: losing the cache only loses the offline floor.
    }
  }

  private checkContract(response: Response): void {
    const header = response.headers.get(MAXIMUS_CONTRACT_HEADER);
    const version = header === null ? undefined : Number(header);
    if (!maximusContractCompatible(version)) throw new ContractMismatchError();
  }

  private async get(path: string): Promise<Response> {
    const headers: Record<string, string> = { [MAXIMUS_CONTRACT_HEADER]: String(MAXIMUS_CONTRACT_VERSION) };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    return this.fetchImpl(`${this.adminOrigin}${path}`, {
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  /**
   * Pulls entitlements + provider policy. Throws ContractMismatchError on a
   * wire mismatch (the caller maps it to 409/503, never a downgrade); on an
   * outage returns the last-good-or-free view marked offline.
   */
  async sync(): Promise<SyncedEntitlements> {
    const now = this.now();
    let entitlementsResponse: Response;
    let providersResponse: Response;
    try {
      [entitlementsResponse, providersResponse] = await Promise.all([
        this.get(`/api/workspaces/${this.workspace}/entitlements`),
        this.get(`/api/workspaces/${this.workspace}/providers`),
      ]);
    } catch (error) {
      return this.markOffline(error instanceof Error ? error.message : String(error));
    }
    if (entitlementsResponse.status === 409 || providersResponse.status === 409) {
      const mismatch = async (response: Response): Promise<boolean> => {
        if (response.status !== 409) return false;
        const body = await response.json().catch(() => null) as { error?: unknown } | null;
        return body?.error === MAXIMUS_CONTRACT_MISMATCH;
      };
      if (await mismatch(entitlementsResponse) || await mismatch(providersResponse)) throw new ContractMismatchError();
    }
    if (!entitlementsResponse.ok || !providersResponse.ok) {
      return this.markOffline(`control plane answered ${entitlementsResponse.status}/${providersResponse.status}`);
    }
    try {
      this.checkContract(entitlementsResponse);
      this.checkContract(providersResponse);
      const entitlementsBody = entitlementsPayload.parse(await entitlementsResponse.json());
      const providersBody = providersPayload.parse(await providersResponse.json());
      if (entitlementsBody.entitlements.workspace !== this.workspace || providersBody.workspace !== this.workspace) {
        throw new Error("workspace mismatch");
      }
      this.entitlements = entitlementsBody.entitlements;
      this.providers = providersBody.providers;
      this.syncedAt = now;
      this.offline = false;
      this.offlineReason = "";
      this.saveCache();
      return this.view();
    } catch (error) {
      if (error instanceof ContractMismatchError) throw error;
      return this.markOffline(error instanceof Error ? error.message : String(error));
    }
  }

  private markOffline(reason: string): SyncedEntitlements {
    this.offline = true;
    this.offlineReason = reason.slice(0, 200);
    return this.view();
  }

  /** Last known state; expired grace degrades to the free tier without a restart. */
  view(): SyncedEntitlements {
    const now = this.now();
    const carried = this.entitlements?.entitlements ?? [];
    const plan = this.entitlements?.plan ?? "free";
    const allowance = this.entitlements?.allowance ?? null;
    let status = this.entitlements?.status ?? "suspended";
    let graceEndsAt = this.entitlements?.graceEndsAt ?? null;
    let entitlements = [...carried];
    if (status === "grace" && graceEndsAt !== null && now >= graceEndsAt) {
      status = "suspended";
      graceEndsAt = null;
      entitlements = [];
    }
    const granted = status === "suspended" && !this.entitlements ? [] : grantedFromCarried(entitlements);
    const banner = this.bannerFor(status, graceEndsAt, plan, now);
    return {
      workspace: this.workspace,
      plan,
      carried,
      granted,
      allowance: status === "suspended" && graceEndsAt === null && this.entitlements?.status === "grace" ? null : allowance,
      status,
      graceEndsAt,
      banner,
      syncedAt: this.syncedAt,
      offline: this.offline,
    };
  }

  private bannerFor(
    status: "active" | "grace" | "suspended",
    graceEndsAt: number | null,
    plan: string,
    now: number,
  ): SyncedBanner | null {
    if (this.offline && this.syncedAt === 0 && this.entitlements === null) {
      return {
        kind: "offline",
        title: "Entitlements unavailable",
        body: `Could not reach the control plane (${this.offlineReason || "outage"}). Running the free tier until it recovers.`,
      };
    }
    if (status === "suspended") {
      return {
        kind: "suspended",
        title: "Subscription ended — free tier",
        body: "This workspace is on the free tier. Upgrade to restore paid features; no workspace data was removed.",
      };
    }
    if (status === "grace" && graceEndsAt !== null) {
      const ends = new Date(graceEndsAt).toISOString().slice(0, 10);
      const days = Math.max(0, Math.ceil((graceEndsAt - now) / (24 * 60 * 60_000)));
      return {
        kind: "grace",
        title: "Payment needs attention",
        body: `Paid features keep working for ${days} more day${days === 1 ? "" : "s"} (until ${ends}). Update payment to stay on ${plan}.`,
      };
    }
    return null;
  }

  /** The synced workspace switchboard level, or null when nothing has synced yet. */
  workspacePolicy(): WorkspacePolicy | null {
    if (this.syncedAt === 0 && !this.entitlements) return null;
    return parseWorkspacePolicy(this.providers);
  }

  /** One startup log line in the editionStatus/licenseWarning shape. */
  startupLog(): string {
    const view = this.view();
    const features = view.granted.join(", ") || "no features";
    if (view.banner) return `hosted entitlements for ${view.workspace}: ${features} (${view.banner.title.toLowerCase()})`;
    return `hosted entitlements for ${view.workspace}: ${features} (${view.plan})${view.offline ? " [cached]" : ""}`;
  }
}
