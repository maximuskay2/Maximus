// Billing state store: one record per workspace plus the set of delivered
// webhook idempotency keys, persisted as one 0600 JSON file written
// atomically. The ONLY thing billing state may touch is this file: suspending
// a workspace withholds features, it never deletes user data. Duplicate
// deliveries are acknowledged without re-applying.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import { idempotencyKey, type BillingEvent } from "./events.ts";
import { applyBillingEvent, settleBillingStatus, type BillingRecord } from "./dunning.ts";
import type { BundledPlan } from "./plans.ts";

const STORE_VERSION = 1;
/** Delivery history is bounded; Stripe/Paystack retries land within days, far inside this window. */
const MAX_DELIVERIES = 5000;

const recordSchema = z.object({
  workspace: z.string(),
  plan: z.string(),
  customerId: z.string(),
  carried: z.array(z.string()),
  allowanceUsd: z.number().nullable(),
  status: z.enum(["active", "grace", "suspended"]),
  graceEndsAt: z.number().nullable(),
  updatedAt: z.number(),
});

const storeSchema = z.object({
  version: z.literal(STORE_VERSION),
  records: z.record(z.string(), recordSchema),
  deliveries: z.array(z.string()).max(MAX_DELIVERIES * 2),
});

export interface BillingStoreOptions {
  dataDir: string;
  plans?: ReadonlyMap<string, BundledPlan>;
  knownEntitlements?: readonly string[];
  now?: () => number;
  graceMs?: number;
}

export type ApplyOutcome = "applied" | "duplicate";

export class BillingStore {
  private readonly file: string;
  private readonly plans: ReadonlyMap<string, BundledPlan>;
  private readonly known: readonly string[];
  private readonly now: () => number;
  private readonly graceMs: number | undefined;
  private records = new Map<string, BillingRecord>();
  private deliveries = new Set<string>();

  constructor(options: BillingStoreOptions) {
    this.file = join(options.dataDir, "billing", "store.json");
    this.plans = options.plans ?? new Map();
    this.known = options.knownEntitlements ?? [];
    this.now = options.now ?? Date.now;
    this.graceMs = options.graceMs;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = storeSchema.safeParse(JSON.parse(readFileSync(this.file, "utf8")));
      if (!parsed.success) return;
      for (const [workspace, record] of Object.entries(parsed.data.records)) this.records.set(workspace, record);
      for (const key of parsed.data.deliveries) this.deliveries.add(key);
    } catch {
      // A corrupt store fails closed to empty: webhooks re-apply cleanly and nothing is granted blindly.
      this.records.clear();
      this.deliveries.clear();
    }
  }

  private save(): void {
    try {
      mkdirSync(join(this.file, ".."), { recursive: true, mode: 0o700 });
      const deliveries = [...this.deliveries].slice(-MAX_DELIVERIES);
      this.deliveries = new Set(deliveries);
      writeFileAtomic(this.file, JSON.stringify({
        version: STORE_VERSION,
        records: Object.fromEntries(this.records),
        deliveries,
      }), { mode: 0o600 });
    } catch {
      // Best effort: the in-memory state still served this delivery.
    }
  }

  seen(event: Pick<BillingEvent, "provider" | "event_id">): boolean {
    return this.deliveries.has(idempotencyKey(event));
  }

  apply(event: BillingEvent): { outcome: ApplyOutcome; record: BillingRecord } {
    const key = idempotencyKey(event);
    if (this.deliveries.has(key)) {
      const record = this.record(event.workspace_id);
      return { outcome: "duplicate", record: record ?? applyBillingEvent(null, event, { now: this.now(), graceMs: this.graceMs }) };
    }
    this.deliveries.add(key);
    const record = applyBillingEvent(this.records.get(event.workspace_id) ?? null, event, {
      now: this.now(),
      graceMs: this.graceMs,
      planAllowanceUsd: this.plans.get(event.plan)?.allowanceUsd ?? null,
    });
    this.records.set(event.workspace_id, record);
    this.save();
    return { outcome: "applied", record };
  }

  /** Settled on read: expired grace degrades without a restart and without a new event. */
  record(workspace: string): BillingRecord | null {
    const record = this.records.get(workspace);
    if (!record) return null;
    const settled = settleBillingStatus(record, this.now());
    if (settled !== record) {
      this.records.set(workspace, settled);
      this.save();
    }
    return settled;
  }

  /** Granted ids: known ids only, sorted; unknown carried ids grant nothing. */
  granted(workspace: string): string[] {
    const record = this.record(workspace);
    if (!record || record.status === "suspended") return [];
    const fromPlan = this.plans.get(record.plan)?.entitlements ?? [];
    return [...new Set([...record.carried, ...fromPlan].filter((id) => this.known.includes(id)))].sort();
  }
}
