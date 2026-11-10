import { z } from "zod";

import type { AccountsConfig } from "./types.ts";

const MAX_ALLOWED_ORIGINS = 20;
const secretSchema = z.string().min(32);
const emailSchema = z.email().max(254);

function exactHTTPSOrigin(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS origin`);
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error(`${label} must be an exact HTTPS origin`);
  }
  return url.origin;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function allowedOrigin(value: string): string {
  try {
    return exactHTTPSOrigin(value, "ALLOWED_ORIGINS");
  } catch {
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ALLOWED_ORIGINS must be exact HTTPS origins (http loopback is for local development)");
  }
  if (
    url.protocol !== "http:"
    || !LOOPBACK_HOSTS.has(url.hostname)
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error("ALLOWED_ORIGINS must be exact HTTPS origins (http loopback is for local development)");
  }
  return url.origin;
}

export function readAccountsConfig(vars: Record<string, string | undefined>): AccountsConfig {
  if (!secretSchema.safeParse(vars.BETTER_AUTH_SECRET).success) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  }
  const emailFrom = emailSchema.safeParse(vars.EMAIL_FROM);
  if (!emailFrom.success) throw new Error("EMAIL_FROM must be a valid email address");
  if (!vars.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL must be a valid HTTPS origin");
  const authBaseURL = exactHTTPSOrigin(vars.BETTER_AUTH_URL, "BETTER_AUTH_URL");
  const values = (vars.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length > MAX_ALLOWED_ORIGINS) {
    throw new Error("ALLOWED_ORIGINS contains too many entries");
  }
  const allowedOrigins = new Set(values.map(allowedOrigin));
  allowedOrigins.add(authBaseURL);
  return { authBaseURL, allowedOrigins, emailFrom: emailFrom.data };
}

export interface AccountsProcessConfig extends AccountsConfig {
  databaseURL: string;
  smtpURL: string | null;
  cronSecret: string;
  port: number;
  devOTPLog: boolean;
}

export function readProcessConfig(vars: Record<string, string | undefined>): AccountsProcessConfig {
  const core = readAccountsConfig(vars);
  const databaseURL = vars.DATABASE_URL?.trim() ?? "";
  if (!databaseURL) throw new Error("DATABASE_URL must be a Postgres connection string");
  const devOTPLog = vars.DEV_OTP_LOG === "1";
  if (devOTPLog && vars.NODE_ENV === "production") {
    throw new Error("DEV_OTP_LOG must never be set in production");
  }
  const smtpURL = vars.SMTP_URL?.trim() ?? "";
  if (!smtpURL && !devOTPLog) throw new Error("SMTP_URL must be set unless DEV_OTP_LOG=1");
  const cronSecret = vars.CRON_SECRET?.trim() ?? "";
  if (cronSecret.length < 16) throw new Error("CRON_SECRET must contain at least 16 characters");
  const port = Number(vars.PORT ?? "8791");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid port");
  return { ...core, databaseURL, smtpURL: smtpURL || null, cronSecret, port, devOTPLog };
}
