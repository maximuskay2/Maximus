// Webhook signature verification for Stripe and Paystack. Secrets arrive as
// arguments (harness-side env, never the repo, never the client); the raw
// request bytes are verified before any JSON is parsed, and comparisons are
// timing-safe. The `sign*` helpers exist only so tests can mint fixtures.
import { createHmac, timingSafeEqual } from "node:crypto";

/** Stripe tolerates a few minutes of clock skew; older deliveries are rejected as replays. */
export const STRIPE_TIMESTAMP_TOLERANCE_SECONDS = 300;

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};

export function signStripePayload(rawBody: string, secret: string, timestampSeconds: number): string {
  const signature = createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`, "utf8").digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}

/** Verifies `Stripe-Signature: t=...,v1=...[,v0=...]` (v0 entries are ignored; any matching v1 passes). */
export function verifyStripeSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !header) return false;
  const parts = header.split(",").map((part) => part.trim());
  const timestamp = Number(parts.find((part) => part.startsWith("t="))?.slice(2));
  const candidates = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!Number.isInteger(timestamp) || timestamp <= 0 || candidates.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > STRIPE_TIMESTAMP_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return candidates.some((candidate) => /^[0-9a-f]{64}$/.test(candidate) && safeEqual(candidate, expected));
}

export function signPaystackPayload(rawBody: string, secret: string): string {
  return createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
}

/** Verifies Paystack's `x-paystack-signature` (hex HMAC-SHA512 over the raw body). */
export function verifyPaystackSignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!secret || !header) return false;
  const expected = signPaystackPayload(rawBody, secret);
  return /^[0-9a-f]{128}$/.test(header.trim()) && safeEqual(header.trim(), expected);
}
