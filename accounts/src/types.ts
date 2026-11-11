import type { TransactionalEmailSender } from "./email.ts";

/** One prepared statement. Call sites keep the `?` placeholder style. */
export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

/** Query surface the route modules use. `batch` runs atomically. */
export interface Database {
  prepare(sql: string): DbStatement;
  batch(statements: DbStatement[]): Promise<{ meta: { changes: number }; results: unknown[] }[]>;
}

export interface JobContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** Runtime configuration the accounts process reads. No Cloudflare fields. */
export interface AccountsConfig {
  authBaseURL: string;
  allowedOrigins: ReadonlySet<string>;
  emailFrom: string;
}

export interface AccountsEnv {
  DB: Database;
  EMAIL: TransactionalEmailSender;
  BETTER_AUTH_SECRET: string;
  [key: string]: unknown;
}
