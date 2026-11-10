// Copyright (c) 2026 Maximus. All rights reserved.
// Proprietary and confidential: this file is part of the Maximus Enterprise
// layer and is licensed under the Maximus Enterprise License
// (maximus-enterprise/LICENSE), not the Apache License 2.0.

// Maximus license keys: `max1.<claims>.<signature>` (base64url JSON claims,
// Ed25519 signature over the UTF-8 bytes of `<claims>`). Clean-room
// implementation of docs/plans/2026-11-06-maximus-contracts.md section 3:
// written from the interface in server/enterprise.ts alone, after upstream
// enterprise/ was deleted. No runtime imports outside node builtins, so the
// packaged bundle stays hermetic.
import { createPublicKey, sign, verify } from "node:crypto";

export const LICENSE_KEY_PREFIX = "max1.";
export const LICENSE_CLAIMS_VERSION = 1;
/** Days before expiry the server starts warning (mirrors core LICENSE_WARN_DAYS). */
export const LICENSE_WARN_DAYS = 30;
/** Days after expiry the key keeps working while it is renewed (core passes its own graceDays to register()). */
export const LICENSE_GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60_000;

export interface LicenseClaims {
  v: 1;
  customer: string;
  features: string[];
  issued: string;
  expires: string | null;
}

export interface VerifiedLicense extends LicenseClaims {
  /** Whole days until expiry at verification time; negative inside the grace period. Null for perpetual keys. */
  expiresInDays: number | null;
  /** True when verified past expiry but inside the grace period. */
  inGrace: boolean;
}

/**
 * Our Ed25519 public keys, raw 32 bytes each as base64url. Append to rotate;
 * never edit or remove a live entry — keys already issued against it must
 * keep verifying. The private halves live outside the repo (file mode 0600).
 */
export const LICENSE_PUBLIC_KEYS: readonly string[] = [
  // Production key 1, generated 2026-11-07 at issue-tooling setup.
  "eO_dY7V4x4PW71QSBj-U9-V7Kyi-KTFQob2Twv3A3pM",
];

const BASE64URL = /^[A-Za-z0-9_-]*$/;
const PUBKEY = /^[A-Za-z0-9_-]{43}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function base64UrlDecode(part: string): Buffer {
  if (!BASE64URL.test(part) || part.length % 4 === 1) throw new Error("not base64url");
  return Buffer.from(part, "base64url");
}

function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const at = Date.UTC(y, m - 1, d);
  const check = new Date(at);
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
}

function invalidClaims(detail: string): Error {
  return new Error(
    `MAXIMUS_LICENSE_KEY carries invalid license claims (${detail}); check the key for truncation or ask for a re-issue`,
  );
}

function parseClaims(claimsPart: string): LicenseClaims {
  let raw: unknown;
  try {
    raw = JSON.parse(base64UrlDecode(claimsPart).toString("utf8"));
  } catch {
    throw invalidClaims("claims are not base64url JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidClaims("claims must be a JSON object");
  const claims = raw as Record<string, unknown>;
  if (claims["v"] !== LICENSE_CLAIMS_VERSION) throw invalidClaims(`v must be ${LICENSE_CLAIMS_VERSION}`);
  if (typeof claims["customer"] !== "string" || !claims["customer"].trim() || claims["customer"].length > 160) {
    throw invalidClaims("customer must be a non-empty string of at most 160 characters");
  }
  if (
    !Array.isArray(claims["features"]) ||
    claims["features"].some((feature) => typeof feature !== "string" || !feature || feature.length > 64)
  ) {
    throw invalidClaims("features must be an array of non-empty strings of at most 64 characters");
  }
  if (typeof claims["issued"] !== "string" || !isCalendarDate(claims["issued"])) {
    throw invalidClaims("issued must be a YYYY-MM-DD date");
  }
  if (claims["expires"] !== null && (typeof claims["expires"] !== "string" || !isCalendarDate(claims["expires"]))) {
    throw invalidClaims("expires must be a YYYY-MM-DD date or null");
  }
  return {
    v: LICENSE_CLAIMS_VERSION,
    customer: claims["customer"],
    features: [...(claims["features"] as string[])],
    issued: claims["issued"] as string,
    expires: claims["expires"] as string | null,
  };
}

function publicKeyOf(base64url: string) {
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: base64url }, format: "jwk" });
}

function signatureMatches(claimsPart: string, signaturePart: string, publicKeys: readonly string[]): boolean {
  let signature: Buffer;
  try {
    signature = base64UrlDecode(signaturePart);
  } catch {
    return false;
  }
  if (signature.length !== 64) return false;
  const data = Buffer.from(claimsPart, "utf8");
  return publicKeys.some((key) => {
    if (!PUBKEY.test(key)) return false;
    try {
      return verify(null, data, publicKeyOf(key), signature);
    } catch {
      return false;
    }
  });
}

export interface VerifyOptions {
  /** Defaults to the baked LICENSE_PUBLIC_KEYS. Tests pass ephemeral keys here; production never overrides it. */
  publicKeys?: readonly string[];
  now?: number;
}

/**
 * Parses and authenticates a key. Never rejects an expired key itself: expiry
 * is a policy decision for register()/core, which know the grace period.
 */
export function verifyLicense(licenseKey: string, options: VerifyOptions = {}): VerifiedLicense {
  if (typeof licenseKey !== "string" || !licenseKey.startsWith(LICENSE_KEY_PREFIX)) {
    throw new Error('MAXIMUS_LICENSE_KEY is not a valid license key (expected "max1.<claims>.<signature>")');
  }
  const parts = licenseKey.split(".");
  if (parts.length !== 3 || !parts[1] || !parts[2]) {
    throw new Error('MAXIMUS_LICENSE_KEY is not a valid license key (expected "max1.<claims>.<signature>")');
  }
  const [, claimsPart, signaturePart] = parts as [string, string, string];
  const claims = parseClaims(claimsPart);
  const publicKeys = options.publicKeys ?? LICENSE_PUBLIC_KEYS;
  if (!publicKeys.length) {
    throw new Error("MAXIMUS_LICENSE_KEY cannot be verified (no license public key is configured)");
  }
  if (!signatureMatches(claimsPart, signaturePart, publicKeys)) {
    throw new Error("MAXIMUS_LICENSE_KEY signature does not match");
  }
  const now = options.now ?? Date.now();
  if (!claims.expires) return { ...claims, expiresInDays: null, inGrace: false };
  const at = new Date(claims.expires).getTime();
  return { ...claims, expiresInDays: Math.ceil((at - now) / DAY_MS), inGrace: now >= at };
}

export interface IssueOptions {
  customer: string;
  /** Entitlement ids (FEATURES). Unknown ids are carried, never rejected. */
  features: string[];
  issued: string;
  /** Null for perpetual keys. */
  expires: string | null;
}

/** Signs claims with an Ed25519 private key (PKCS#8 PEM). Used by scripts/issue-license.mjs. */
export function issueLicense(options: IssueOptions, privateKeyPem: string): string {
  const claims: LicenseClaims = {
    v: LICENSE_CLAIMS_VERSION,
    customer: options.customer,
    features: [...options.features],
    issued: options.issued,
    expires: options.expires,
  };
  // Reuse the verifier's shape rules so no issued key fails to parse.
  parseClaims(Buffer.from(JSON.stringify(claims), "utf8").toString("base64url"));
  const claimsPart = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = sign(null, Buffer.from(claimsPart, "utf8"), { key: privateKeyPem, format: "pem" });
  return `${LICENSE_KEY_PREFIX}${claimsPart}.${signature.toString("base64url")}`;
}
