import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

import { readAccountsConfig } from "../src/config.ts";
import { createDatabase, createPool } from "../src/db.ts";
import { migrate } from "../src/migrate.ts";
import type { RouterDeps } from "../src/router.ts";
import type { AccountsConfig, AccountsEnv, JobContext } from "../src/types.ts";

export const BASE_URL = "https://auth.maximus.test";
export const TEST_AUTH_SECRET = "test-only-better-auth-secret-with-more-than-32-characters";
export const TEST_CRON_SECRET = "test-only-cron-secret-value-32-chars!";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let pool: Pool | null = null;
let config: AccountsConfig | null = null;

export interface SentMessage {
  to: string;
  from: { email: string; name: string };
  subject: string;
  html: string;
  text: string;
}

export const sentMail: SentMessage[] = [];

export function testPool(): Pool {
  if (!pool) throw new Error("test database is not set up");
  return pool;
}

export function testConfig(): AccountsConfig {
  if (!config) throw new Error("test database is not set up");
  return config;
}

export function testEnv(overrides: Record<string, unknown> = {}): AccountsEnv {
  return {
    BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
    BETTER_AUTH_URL: "https://accounts.maximus.test",
    ALLOWED_ORIGINS: "https://app.maximus.test",
    EMAIL_FROM: "nobody@maximus.test",
    DEV_OTP_LOG: "0",
    RELAY_DISABLED: "0",
    RELAY_NODES: "relay1.maximus.com",
    RELAY_NODES_AMERICAS: "",
    RELAY_TOKEN_KID: "k1",
    RELAY_ROLLOUT_PERCENT: "0",
    RELAY_ALLOW_INSTALLATIONS: "",
    DB: createDatabase(testPool()),
    EMAIL: {
      send: async (message) => {
        sentMail.push({ ...message, from: { ...message.from } });
      },
    },
    ...overrides,
  };
}

const overlay: Record<string, unknown> = {};

function liveEnv(): AccountsEnv {
  return testEnv(overlay);
}

export const env: AccountsEnv = new Proxy({} as AccountsEnv, {
  get: (_target, property) => (liveEnv() as unknown as Record<string | symbol, unknown>)[property],
  set: (_target, property, value) => {
    if (typeof property === "string") overlay[property] = value;
    return true;
  },
  deleteProperty: (_target, property) => {
    if (typeof property === "string") delete overlay[property];
    return true;
  },
  ownKeys: () => Reflect.ownKeys(liveEnv()),
  getOwnPropertyDescriptor: (_target, property) => ({
    enumerable: true,
    configurable: true,
    value: (liveEnv() as unknown as Record<string | symbol, unknown>)[property],
  }),
  has: (_target, property) => property in liveEnv(),
});

export interface TestContext extends JobContext {
  pending: Promise<unknown>[];
}

export function createExecutionContext(): TestContext {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise.catch(() => {}));
    },
  };
}

export async function waitOnExecutionContext(ctx: TestContext): Promise<void> {
  while (ctx.pending.length > 0) {
    await Promise.all(ctx.pending.splice(0));
  }
}

export function testDeps(
  testEnv: AccountsEnv,
  ctx: JobContext,
  extra: Partial<RouterDeps> = {},
): RouterDeps {
  return {
    env: testEnv,
    ctx,
    config: testConfig(),
    pool: testPool(),
    requestId: "",
    cronSecret: TEST_CRON_SECRET,
    ...extra,
  };
}

type QueryArgs = [text: string, params?: unknown[]];

export function loggingPool(queries: string[], failOn?: RegExp): Pool {
  const inner = testPool();
  const wrapQuery = (query: (...args: QueryArgs) => Promise<unknown>) =>
    async (...args: QueryArgs): Promise<unknown> => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      queries.push(args[0].replace(/\s+/g, " ").trim());
      if (failOn?.test(args[0])) throw new Error("PG_ERROR: injected failure");
      return query(...args);
    };
  return new Proxy(inner, {
    get: (target, property) => {
      if (property === "query") {
        return wrapQuery(target.query.bind(target) as (...args: QueryArgs) => Promise<unknown>);
      }
      if (property === "connect") {
        return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get: (clientTarget, clientProperty) => {
              if (clientProperty === "query") {
                return wrapQuery(clientTarget.query.bind(clientTarget) as (...args: QueryArgs) => Promise<unknown>);
              }
              const value: unknown = clientTarget[clientProperty as keyof typeof clientTarget];
              return typeof value === "function" ? value.bind(clientTarget) : value;
            },
          });
        };
      }
      const value: unknown = target[property as keyof Pool];
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Pool;
}

export function tracedEnv(queries: string[], failOn?: RegExp): { env: AccountsEnv; pool: Pool } {
  const traced = loggingPool(queries, failOn);
  return { env: testEnv({ DB: createDatabase(traced) }), pool: traced };
}

export async function setupTestDatabase(): Promise<void> {
  const url = process.env.ACCOUNTS_TEST_DATABASE_URL
    ?? "postgres://postgres:test-only-accounts-pw@127.0.0.1:5544/accounts_test";
  pool = createPool(url);
  await migrate(pool, MIGRATIONS_DIR);
  config = readAccountsConfig({
    BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
    BETTER_AUTH_URL: "https://accounts.maximus.test",
    ALLOWED_ORIGINS: "https://app.maximus.test",
    EMAIL_FROM: "nobody@maximus.test",
  });
}

const TRUNCATE_TABLES = [
  '"user"',
  '"session"',
  '"account"',
  '"verification"',
  '"rateLimit"',
  "installations",
  "installation_credentials",
  "otp_recipient_rate_limits",
  "control_action_rate_limits",
  "installation_action_rate_limits",
  "installation_push_devices",
  "highlevel_flows",
  "highlevel_ip_rate_limits",
  "relay_adoption",
  "workspaces",
  "workspace_members",
  "workspace_invites",
  "workspace_provider_policies",
  "operator_provider_policies",
  "operator_mail",
  "workspace_oidc_configs",
  "workspace_audit_log",
  "workspace_spend",
  "workspace_tokens",
  "store_subscriptions",
  "plan_catalog",
];

export async function resetTestDatabase(): Promise<void> {
  await testPool().query(`TRUNCATE ${TRUNCATE_TABLES.join(", ")} CASCADE`);
  sentMail.length = 0;
  for (const key of Object.keys(overlay)) delete overlay[key];
}

export async function teardownTestDatabase(): Promise<void> {
  await pool?.end().catch(() => {});
  pool = null;
  config = null;
}
