// Phase 8: App Store / Play subscription verification. The phone buys
// through the store, then the server proxy calls verify(); Apple and
// Google server notifications land on the webhook handlers. Store
// webhooks are UNTRUSTED triggers: every grant follows a server-side
// API read (App Store Server API / Play Developer API) over TLS, so no
// certificate-chain code is needed and a forged notification grants
// nothing. Without owner credentials every route fails closed (503).
import { PLAN_CATALOG, type BillingEvent, type BillingEventType } from "./entitlements";
import { contractJSON, assertContract } from "./contract";
import { HTTPError } from "./http";
import { requireAccount, WORKSPACE_ID } from "./workspaces";
import type { ControlPlaneAuth } from "./auth";

/** Store product id → workspace plan. OWNER: create these identically in
 * App Store Connect / Play Console (monthly, individual) and mirror them
 * in mobile/lib/billing/products.dart. */
export const STORE_PRODUCT_PLANS: Readonly<Record<string, string>> = {
  maximus_plus_monthly: "team",
  maximus_pro_monthly: "business",
};

const APPLE_PROD = "https://api.storekit.itunes.apple.com";
const APPLE_SANDBOX = "https://api.storekit-sandbox.itunes.apple.com";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_PUBLISHER = "https://androidpublisher.googleapis.com/androidpublisher/v3";

type FetchImpl = typeof fetch;

export interface StoreDeps {
  fetchImpl?: FetchImpl;
  now?: () => number;
}

interface AppleCreds {
  issuerId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
}

interface GoogleCreds {
  clientEmail: string;
  privateKey: string;
  packageName: string;
}

function appleCreds(env: Env): AppleCreds | null {
  const anyEnv = env as Record<string, string | undefined>;
  const issuerId = anyEnv.APPSTORE_ISSUER_ID;
  const keyId = anyEnv.APPSTORE_KEY_ID;
  const privateKey = anyEnv.APPSTORE_PRIVATE_KEY;
  const bundleId = anyEnv.APPSTORE_BUNDLE_ID;
  if (!issuerId || !keyId || !privateKey || !bundleId) return null;
  return { issuerId, keyId, privateKey, bundleId };
}

function googleCreds(env: Env): GoogleCreds | null {
  const anyEnv = env as Record<string, string | undefined>;
  const raw = anyEnv.GOOGLE_SERVICE_ACCOUNT;
  const packageName = anyEnv.GOOGLE_PACKAGE_NAME;
  if (!raw || !packageName) return null;
  try {
    const parsed = JSON.parse(raw) as { client_email?: unknown; private_key?: unknown };
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") return null;
    return { clientEmail: parsed.client_email, privateKey: parsed.private_key, packageName };
  } catch {
    return null;
  }
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(segment: string): Record<string, unknown> | null {
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Middle segment of a JWS, decoded WITHOUT verification. Callers must
 * confirm security-sensitive fields through a server API read. */
export function decodeJwsPayload(jws: string): Record<string, unknown> | null {
  const parts = jws.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  return b64urlJson(parts[1]);
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Short-lived App Store Server API token (ES256). */
async function appleToken(creds: AppleCreds, now: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(creds.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: creds.keyId, typ: "JWT" })));
  const payload = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: creds.issuerId,
        iat: Math.floor(now / 1000),
        exp: Math.floor(now / 1000) + 1800,
        aud: "appstoreconnect-v1",
        bid: creds.bundleId,
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64url(signature)}`;
}

export interface AppleTransaction {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  expiresDate: number | null;
  revoked: boolean;
}

function parseAppleTransaction(info: Record<string, unknown>): AppleTransaction | null {
  const { transactionId, originalTransactionId, productId, expiresDate, revocationDate } = info;
  if (typeof transactionId !== "string" || typeof originalTransactionId !== "string" || typeof productId !== "string") {
    return null;
  }
  return {
    transactionId,
    originalTransactionId,
    productId,
    expiresDate: typeof expiresDate === "number" ? expiresDate : null,
    revoked: typeof revocationDate === "number",
  };
}

/** Reads one transaction from Apple (production, then sandbox). Returns
 * null when Apple has no such transaction. */
export async function appleTransaction(
  creds: AppleCreds,
  transactionId: string,
  fetchImpl: FetchImpl,
  now: number,
): Promise<AppleTransaction | null> {
  const token = await appleToken(creds, now);
  for (const host of [APPLE_PROD, APPLE_SANDBOX]) {
    const res = await fetchImpl(`${host}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new HTTPError(502, "store_unreachable");
    const body = (await res.json().catch(() => null)) as { signedTransactionInfo?: unknown } | null;
    const info = typeof body?.signedTransactionInfo === "string" ? decodeJwsPayload(body.signedTransactionInfo) : null;
    const parsed = info ? parseAppleTransaction(info) : null;
    if (!parsed) throw new HTTPError(502, "store_unreachable");
    return parsed;
  }
  return null;
}

async function googleAccessToken(creds: GoogleCreds, fetchImpl: FetchImpl, now: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(creds.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: creds.clientEmail,
        scope: "https://www.googleapis.com/auth/androidpublisher",
        aud: GOOGLE_TOKEN_URL,
        iat: Math.floor(now / 1000),
        exp: Math.floor(now / 1000) + 1800,
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${header}.${payload}.${b64url(signature)}`,
  });
  if (!res.ok) throw new HTTPError(502, "store_unreachable");
  const body = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
  if (typeof body?.access_token !== "string") throw new HTTPError(502, "store_unreachable");
  return body.access_token;
}

export interface GoogleSubscription {
  productId: string;
  expiryMs: number | null;
  acknowledged: boolean;
}

export async function googleSubscription(
  creds: GoogleCreds,
  purchaseToken: string,
  fetchImpl: FetchImpl,
  now: number,
): Promise<GoogleSubscription | null> {
  const token = await googleAccessToken(creds, fetchImpl, now);
  const url =
    `${GOOGLE_PUBLISHER}/applications/${encodeURIComponent(creds.packageName)}` +
    `/purchases/subscriptionsv2/${encodeURIComponent(purchaseToken)}`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new HTTPError(502, "store_unreachable");
  const body = (await res.json().catch(() => null)) as {
    lineItems?: Array<{ productId?: unknown; expiryTime?: unknown }>;
    acknowledgementState?: unknown;
  } | null;
  const item = body?.lineItems?.[0];
  if (typeof item?.productId !== "string") throw new HTTPError(502, "store_unreachable");
  const expiry = typeof item.expiryTime === "string" ? Date.parse(item.expiryTime) : NaN;
  return {
    productId: item.productId,
    expiryMs: Number.isFinite(expiry) ? expiry : null,
    acknowledged: item && (body?.acknowledgementState === "ACKNOWLEDGED" || body?.acknowledgementState === 1),
  };
}

async function googleAcknowledge(
  creds: GoogleCreds,
  purchaseToken: string,
  fetchImpl: FetchImpl,
  now: number,
): Promise<void> {
  const token = await googleAccessToken(creds, fetchImpl, now);
  const url =
    `${GOOGLE_PUBLISHER}/applications/${encodeURIComponent(creds.packageName)}` +
    `/purchases/subscriptionsv2/${encodeURIComponent(purchaseToken)}:acknowledge`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok && res.status !== 404) throw new HTTPError(502, "store_unreachable");
}

interface StoreRow {
  workspace_id: string;
  platform: string;
  product_id: string;
  transaction_id: string;
  status: string;
  expires_at: number | null;
}

async function storeRow(env: Env, workspace: string): Promise<StoreRow | null> {
  return env.DB.prepare("SELECT * FROM store_subscriptions WHERE workspace_id = ?")
    .bind(workspace)
    .first<StoreRow>();
}

/** No-double-subscribe gate. Returns the normalized decision; throws 409
 * when another paid grant already holds the workspace. */
export async function checkDoubleSubscribe(
  env: Env,
  workspace: string,
  platform: "apple" | "google",
): Promise<{ renewal: boolean }> {
  const existing = await storeRow(env, workspace);
  if (existing && (existing.status === "active" || existing.status === "grace")) {
    if (existing.platform !== platform) {
      throw new HTTPError(409, "already_subscribed");
    }
    return { renewal: true };
  }
  const row = await env.DB.prepare("SELECT plan FROM workspaces WHERE id = ?").bind(workspace).first<{ plan: string }>();
  if (!row) throw new HTTPError(404, "not_found");
  if (row.plan !== "free") throw new HTTPError(409, "already_subscribed");
  return { renewal: false };
}

async function grantStoreSubscription(
  env: Env,
  apply: (event: BillingEvent) => Promise<unknown>,
  input: {
    workspace: string;
    platform: "apple" | "google";
    productId: string;
    transactionId: string;
    expiresAt: number | null;
    eventId: string;
    firstGrant: boolean;
  },
  now: number,
): Promise<{ plan: string }> {
  const plan = STORE_PRODUCT_PLANS[input.productId];
  if (!plan) throw new HTTPError(400, "unknown_product");
  const def = PLAN_CATALOG[plan];
  if (!def) throw new HTTPError(500, "internal_error");
  const type: BillingEventType = input.firstGrant ? "billing.checkout_completed" : "billing.subscription_updated";
  await apply({
    event_id: input.eventId,
    type,
    created_at: new Date(now).toISOString(),
    provider: input.platform,
    livemode: true,
    workspace_id: input.workspace,
    customer_id: `${input.platform}:${input.transactionId}`,
    plan,
    entitlements: [...def.entitlements],
    allowance: def.allowance,
  });
  await env.DB.prepare(
    `INSERT INTO store_subscriptions (workspace_id, platform, product_id, transaction_id, status, expires_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT (workspace_id) DO UPDATE SET
       platform = excluded.platform, product_id = excluded.product_id,
       transaction_id = excluded.transaction_id, status = 'active',
       expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
  ).bind(input.workspace, input.platform, input.productId, input.transactionId, input.expiresAt, now).run();
  return { plan };
}

async function endStoreSubscription(
  env: Env,
  apply: (event: BillingEvent) => Promise<unknown>,
  input: { workspace: string; platform: "apple" | "google"; eventId: string; revoked: boolean },
  now: number,
): Promise<void> {
  const existing = await storeRow(env, input.workspace);
  const plan = existing ? STORE_PRODUCT_PLANS[existing.product_id] ?? "free" : "free";
  const def = PLAN_CATALOG[plan] ?? PLAN_CATALOG.free!;
  await apply({
    event_id: input.eventId,
    type: "billing.subscription_cancelled",
    created_at: new Date(now).toISOString(),
    provider: input.platform,
    livemode: true,
    workspace_id: input.workspace,
    customer_id: existing ? `${input.platform}:${existing.transaction_id}` : `${input.platform}:unknown`,
    plan,
    entitlements: [...def.entitlements],
    allowance: def.allowance,
  });
  await env.DB.prepare("UPDATE store_subscriptions SET status = ?, updated_at = ? WHERE workspace_id = ?")
    .bind(input.revoked ? "revoked" : "expired", now, input.workspace)
    .run();
}

async function readJson(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HTTPError(413, "request_too_large");
  try {
    const parsed: unknown = JSON.parse(text || "{}");
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new HTTPError(400, "invalid_request");
  }
}

/** POST /api/billing/store/verify — the phone hands a store receipt;
 * the worker confirms it with Apple/Google and grants the workspace. */
export async function verifyStorePurchase(
  request: Request,
  env: Env,
  auth: ControlPlaneAuth,
  apply: (event: BillingEvent) => Promise<unknown>,
  deps: StoreDeps = {},
): Promise<Response> {
  assertContract(request);
  const session = await requireAccount(request, auth);
  const body = await readJson(request, 32_768);
  const workspace = typeof body.workspace === "string" ? body.workspace : "";
  const platform = body.platform === "apple" || body.platform === "google" ? body.platform : null;
  const receipt = typeof body.receipt === "string" ? body.receipt : "";
  if (!WORKSPACE_ID.test(workspace) || !platform || !receipt || receipt.length > 16_384) {
    throw new HTTPError(400, "invalid_request");
  }
  const member = await env.DB.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
    .bind(workspace, session.user.id)
    .first<{ role: string }>();
  if (!member) throw new HTTPError(404, "not_found");
  if (member.role !== "admin") throw new HTTPError(403, "forbidden");

  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now?.() ?? Date.now();
  const { renewal } = await checkDoubleSubscribe(env, workspace, platform);

  if (platform === "apple") {
    const creds = appleCreds(env);
    if (!creds) throw new HTTPError(503, "store_unavailable");
    // The receipt is the transaction's JWS (or its id): the id is what
    // Apple is asked about; the payload is never trusted.
    const payload = decodeJwsPayload(receipt);
    const candidate =
      (typeof payload?.transactionId === "string" && payload.transactionId) ||
      (/^[0-9a-zA-Z_-]{1,128}$/.test(receipt) ? receipt : "");
    if (!candidate) throw new HTTPError(400, "invalid_receipt");
    const tx = await appleTransaction(creds, candidate, fetchImpl, now);
    if (!tx || tx.revoked || (tx.expiresDate !== null && tx.expiresDate <= now)) {
      throw new HTTPError(400, "invalid_receipt");
    }
    const { plan } = await grantStoreSubscription(env, apply, {
      workspace,
      platform,
      productId: tx.productId,
      transactionId: tx.originalTransactionId,
      expiresAt: tx.expiresDate,
      eventId: `apple:${tx.transactionId}`,
      firstGrant: !renewal,
    }, now);
    return contractJSON({ subscription: { workspace, platform, plan, productId: tx.productId, expiresAt: tx.expiresDate } });
  }

  const creds = googleCreds(env);
  if (!creds) throw new HTTPError(503, "store_unavailable");
  let token = "";
  let productHint = "";
  try {
    const parsed: unknown = JSON.parse(receipt);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.purchaseToken === "string") token = record.purchaseToken;
      if (typeof record.productId === "string") productHint = record.productId;
    }
  } catch {
    token = receipt;
  }
  if (!token || token.length > 4096) throw new HTTPError(400, "invalid_receipt");
  const sub = await googleSubscription(creds, token, fetchImpl, now);
  if (!sub || (sub.expiryMs !== null && sub.expiryMs <= now)) throw new HTTPError(400, "invalid_receipt");
  if (productHint && sub.productId !== productHint) throw new HTTPError(400, "invalid_receipt");
  if (!sub.acknowledged) await googleAcknowledge(creds, token, fetchImpl, now).catch(() => {});
  const { plan } = await grantStoreSubscription(env, apply, {
    workspace,
    platform,
    productId: sub.productId,
    transactionId: token,
    expiresAt: sub.expiryMs,
    eventId: `google:${token.slice(0, 64)}`,
    firstGrant: !renewal,
  }, now);
  return contractJSON({ subscription: { workspace, platform, plan, productId: sub.productId, expiresAt: sub.expiryMs } });
}

/** GET /api/billing/store/status?workspace= — what the paywall shows. */
export async function storeStatus(request: Request, env: Env, auth: ControlPlaneAuth): Promise<Response> {
  assertContract(request);
  const session = await requireAccount(request, auth);
  const workspace = new URL(request.url).searchParams.get("workspace") ?? "";
  if (!WORKSPACE_ID.test(workspace)) throw new HTTPError(404, "not_found");
  const member = await env.DB.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
    .bind(workspace, session.user.id)
    .first<{ role: string }>();
  if (!member) throw new HTTPError(404, "not_found");
  const existing = await storeRow(env, workspace);
  if (!existing || (existing.status !== "active" && existing.status !== "grace")) {
    return contractJSON({ subscription: { workspace, subscribed: false } });
  }
  const plan = STORE_PRODUCT_PLANS[existing.product_id] ?? "free";
  return contractJSON({
    subscription: {
      workspace,
      subscribed: true,
      platform: existing.platform,
      productId: existing.product_id,
      plan,
      status: existing.status,
      expiresAt: existing.expires_at,
    },
  });
}

const APPLE_GRANT_TYPES = new Set(["SUBSCRIBED", "DID_RENEW", "OFFER_REDEEMED"]);
const APPLE_END_TYPES = new Set(["EXPIRED", "GRACE_PERIOD_EXPIRED", "REFUND", "REVOKE"]);

/** POST /api/billing/webhook/apple — App Store Server Notifications V2.
 * The signed payload names a transaction; the grant follows a fresh
 * App Store Server API read, never the payload. */
export async function appleStoreWebhook(
  request: Request,
  env: Env,
  apply: (event: BillingEvent) => Promise<unknown>,
  deps: StoreDeps = {},
): Promise<Response> {
  const creds = appleCreds(env);
  if (!creds) throw new HTTPError(503, "store_unavailable");
  const body = await readJson(request, 65_536);
  const payload = typeof body.signedPayload === "string" ? decodeJwsPayload(body.signedPayload) : null;
  const data = payload?.data as Record<string, unknown> | undefined;
  const txInfo =
    data && typeof data.signedTransactionInfo === "string" ? decodeJwsPayload(data.signedTransactionInfo) : null;
  const type = typeof payload?.notificationType === "string" ? payload.notificationType : "";
  const uuid = typeof payload?.notificationUUID === "string" ? payload.notificationUUID : "";
  const originalId = typeof txInfo?.originalTransactionId === "string" ? txInfo.originalTransactionId : "";
  if (!type || !uuid || !originalId) throw new HTTPError(400, "invalid_request");

  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now?.() ?? Date.now();
  const existing = await env.DB.prepare("SELECT * FROM store_subscriptions WHERE transaction_id = ?")
    .bind(originalId)
    .first<StoreRow>();
  const txId = typeof txInfo?.transactionId === "string" ? txInfo.transactionId : "";
  if (APPLE_GRANT_TYPES.has(type)) {
    if (!existing) throw new HTTPError(404, "not_found");
    const tx = txId ? await appleTransaction(creds, txId, fetchImpl, now) : null;
    if (!tx || tx.revoked || (tx.expiresDate !== null && tx.expiresDate <= now)) {
      throw new HTTPError(400, "invalid_receipt");
    }
    await grantStoreSubscription(env, apply, {
      workspace: existing.workspace_id,
      platform: "apple",
      productId: tx.productId,
      transactionId: tx.originalTransactionId,
      expiresAt: tx.expiresDate,
      eventId: `apple:${uuid}`,
      firstGrant: false,
    }, now);
    return contractJSON({ ok: true });
  }
  if (APPLE_END_TYPES.has(type)) {
    if (!existing) return contractJSON({ ok: true });
    // Confirm the end state with Apple before revoking the grant.
    const tx = txId ? await appleTransaction(creds, txId, fetchImpl, now).catch(() => null) : null;
    const ended =
      !tx || tx.revoked || type === "REFUND" || type === "REVOKE" || (tx.expiresDate !== null && tx.expiresDate <= now);
    if (!ended) return contractJSON({ ok: true });
    await endStoreSubscription(env, apply, {
      workspace: existing.workspace_id,
      platform: "apple",
      eventId: `apple:${uuid}`,
      revoked: type === "REFUND" || type === "REVOKE",
    }, now);
    return contractJSON({ ok: true });
  }
  // DID_CHANGE_RENEWAL_STATUS and the rest carry no grant change.
  return contractJSON({ ok: true });
}

const GOOGLE_GRANT_TYPES = new Set([1, 2, 4, 7]); // recovered, renewed, purchased, restarted
const GOOGLE_END_TYPES = new Set([3, 5, 12, 13]); // canceled, on hold, revoked, expired

/** POST /api/billing/webhook/google — Pub/Sub push for RTDN. Shared
 * secret query (?secret=) plus a fresh Play API read before any grant. */
export async function googleStoreWebhook(
  request: Request,
  env: Env,
  apply: (event: BillingEvent) => Promise<unknown>,
  deps: StoreDeps = {},
): Promise<Response> {
  const anyEnv = env as Record<string, string | undefined>;
  const secret = anyEnv.GOOGLE_RTDN_SECRET;
  const creds = googleCreds(env);
  if (!creds || !secret) throw new HTTPError(503, "store_unavailable");
  if (new URL(request.url).searchParams.get("secret") !== secret) throw new HTTPError(401, "unauthorized");
  const body = await readJson(request, 65_536);
  const message = body.message as Record<string, unknown> | undefined;
  const messageId = typeof message?.messageId === "string" ? message.messageId : "";
  let note: Record<string, unknown> | null = null;
  if (message && typeof message.data === "string") {
    try {
      note = JSON.parse(atob(message.data)) as Record<string, unknown>;
    } catch {
      note = null;
    }
  }
  const sub = note?.subscriptionNotification as Record<string, unknown> | undefined;
  const noteType = typeof sub?.notificationType === "number" ? sub.notificationType : -1;
  const token = typeof sub?.purchaseToken === "string" ? sub.purchaseToken : "";
  if (!messageId || !note || noteType < 0 || !token) throw new HTTPError(400, "invalid_request");

  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now?.() ?? Date.now();
  const existing = await env.DB.prepare("SELECT * FROM store_subscriptions WHERE transaction_id = ?")
    .bind(token)
    .first<StoreRow>();
  if (GOOGLE_GRANT_TYPES.has(noteType)) {
    if (!existing) throw new HTTPError(404, "not_found");
    const live = await googleSubscription(creds, token, fetchImpl, now);
    if (!live || (live.expiryMs !== null && live.expiryMs <= now)) throw new HTTPError(400, "invalid_receipt");
    await grantStoreSubscription(env, apply, {
      workspace: existing.workspace_id,
      platform: "google",
      productId: live.productId,
      transactionId: token,
      expiresAt: live.expiryMs,
      eventId: `google:${messageId}`,
      firstGrant: false,
    }, now);
    return contractJSON({ ok: true });
  }
  if (GOOGLE_END_TYPES.has(noteType)) {
    if (!existing) return contractJSON({ ok: true });
    const live = await googleSubscription(creds, token, fetchImpl, now).catch(() => null);
    // Cancel/revoke ends the grant even when the paid period still runs:
    // the grace transition keeps service until expiry.
    const ended = !live || live.expiryMs === null || noteType === 3 || noteType === 12 || noteType === 13;
    if (!ended && noteType === 5) {
      // On hold with time left: keep the grant, let the next event decide.
      return contractJSON({ ok: true });
    }
    if (!ended) return contractJSON({ ok: true });
    await endStoreSubscription(env, apply, {
      workspace: existing.workspace_id,
      platform: "google",
      eventId: `google:${messageId}`,
      revoked: noteType === 12,
    }, now);
    return contractJSON({ ok: true });
  }
  return contractJSON({ ok: true });
}
