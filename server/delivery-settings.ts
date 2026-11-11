import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const FILE = "delivery.json";

const storedSchema = z.object({
  host: z.string().max(253),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(200),
  password: z.string().max(500),
  from: z.string().max(200),
  formatModel: z.string().max(80),
  ceilings: z.record(z.string(), z.number().finite().min(0).max(1_000_000)),
});

export type StoredDelivery = z.infer<typeof storedSchema>;

const EMPTY: StoredDelivery = {
  host: "",
  port: 587,
  username: "",
  password: "",
  from: "",
  formatModel: "",
  ceilings: {},
};

const patchSchema = z.object({
  host: z.string().trim().min(1).max(253).refine((host) => !/[\s/@:]/.test(host)),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(200).default(""),
  password: z.string().max(500).optional(),
  from: z.string().trim().max(200).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  formatModel: z.string().max(80).default(""),
  ceilings: z.record(
    z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    z.number().finite().min(0).max(1_000_000),
  ).default({}),
});

export function readDelivery(dataDir: string): StoredDelivery {
  try {
    const parsed = storedSchema.safeParse(JSON.parse(readFileSync(join(dataDir, FILE), "utf8")));
    return parsed.success ? parsed.data : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

export function writeDelivery(dataDir: string, value: StoredDelivery): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, FILE), JSON.stringify(value), { mode: 0o600 });
}

export function applyDeliveryPatch(current: StoredDelivery, body: unknown): { ok: true; value: StoredDelivery } | { ok: false; error: string } {
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: "Enter a mail host, a port, and a from address." };
  const next = parsed.data;
  return {
    ok: true,
    value: {
      host: next.host,
      port: next.port,
      username: next.username,
      password: next.password && next.password.length > 0 ? next.password : current.password,
      from: next.from,
      formatModel: next.formatModel,
      ceilings: next.ceilings,
    },
  };
}

export function deliveryView(value: StoredDelivery, synced: boolean | null = null) {
  return {
    host: value.host,
    port: value.port,
    username: value.username,
    from: value.from,
    passwordSet: value.password.length > 0,
    formatModel: value.formatModel,
    ceilings: value.ceilings,
    synced,
  };
}
