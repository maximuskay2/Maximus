// Phase 8: store subscription verification, status, and webhooks with
// mocked Apple/Google APIs and generated signing keys.
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuth } from "../src/auth";
import { readConfig } from "../src/config";
import worker from "../src/index";

const BASE_URL = "https://auth.maximus.test";
let serial = 8000;

function slug(prefix: string): string {
  serial += 1;
  return `${prefix}-${serial}-store`.toLowerCase();
}

async function call(path: string, options: { method?: string; token?: string; body?: unknown; query?: string } = {}) {
  const headers = new Headers();
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const request = new Request(`${BASE_URL}${path}${options.query ?? ""}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function signIn(email: string): Promise<string> {
  const ctx = createExecutionContext();
  const auth = createAuth(env, ctx, readConfig(env), crypto.randomUUID());
  const otp = await auth.api.createVerificationOTP({ body: { email, type: "sign-in" } });
  await waitOnExecutionContext(ctx);
  const response = await call("/api/auth/sign-in/email-otp", {
    method: "POST",
    body: { email, otp, name: email.split("@", 1)[0] },
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-auth-token")!;
}

function b64urlJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Unsigned JWS fixture: the worker decodes the payload and confirms
 * security-sensitive fields through a fresh API read. */
function jws(payload: unknown): string {
  return `${b64urlJson({ alg: "none" })}.${b64urlJson(payload)}.sig`;
}

async function ecPrivateKeyPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let binary = "";
  for (const byte of der) binary += String.fromCharCode(byte);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----`;
}

async function rsaPrivateKeyPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let binary = "";
  for (const byte of der) binary += String.fromCharCode(byte);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----`;
}

const APPLE_KEYS = ["APPSTORE_ISSUER_ID", "APPSTORE_KEY_ID", "APPSTORE_PRIVATE_KEY", "APPSTORE_BUNDLE_ID"] as const;
const GOOGLE_KEYS = ["GOOGLE_SERVICE_ACCOUNT", "GOOGLE_PACKAGE_NAME", "GOOGLE_RTDN_SECRET"] as const;

function saveEnv(): Record<string, string | undefined> {
  const anyEnv = env as unknown as Record<string, string | undefined>;
  return Object.fromEntries([...APPLE_KEYS, ...GOOGLE_KEYS].map((key) => [key, anyEnv[key]]));
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  const anyEnv = env as unknown as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete anyEnv[key];
    else anyEnv[key] = value;
  }
}

function setApple(pem: string): void {
  const anyEnv = env as unknown as Record<string, string | undefined>;
  anyEnv.APPSTORE_ISSUER_ID = "issuer-1";
  anyEnv.APPSTORE_KEY_ID = "key-1";
  anyEnv.APPSTORE_PRIVATE_KEY = pem;
  anyEnv.APPSTORE_BUNDLE_ID = "com.maximus.app";
}

function setGoogle(pem: string): void {
  const anyEnv = env as unknown as Record<string, string | undefined>;
  anyEnv.GOOGLE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "svc@example.test", private_key: pem });
  anyEnv.GOOGLE_PACKAGE_NAME = "com.maximus.app";
  anyEnv.GOOGLE_RTDN_SECRET = "rtdn-secret";
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("store billing", () => {
  it("verifies an Apple purchase and grants the mapped plan", async () => {
    const saved = saveEnv();
    try {
      setApple(await ecPrivateKeyPem());
      const admin = await signIn(`store-admin-${serial}@example.test`);
      const workspace = slug("ws");
      await call("/api/auth/signup", { method: "POST", token: admin, body: { workspace } });

      const expires = Date.now() + 30 * 24 * 3600_000;
      const txPayload = {
        transactionId: "tx-1",
        originalTransactionId: "orig-1",
        productId: "maximus_plus_monthly",
        expiresDate: expires,
      };
      const seen: string[] = [];
      vi.stubGlobal("fetch", async (url: unknown) => {
        const href = String(url);
        seen.push(href);
        if (href.includes("/inApps/v1/transactions/")) {
          return Response.json({ signedTransactionInfo: jws(txPayload) });
        }
        throw new Error(`unexpected fetch ${href}`);
      });

      const verify = await call("/api/billing/store/verify", {
        method: "POST",
        token: admin,
        body: { workspace, platform: "apple", receipt: jws(txPayload) },
      });
      expect(verify.status).toBe(200);
      const granted = (await verify.json()) as { subscription: { plan: string; productId: string } };
      expect(granted.subscription).toMatchObject({ plan: "team", productId: "maximus_plus_monthly" });
      expect(seen.some((href) => href.includes("api.storekit.itunes.apple.com"))).toBe(true);

      const status = await call(`/api/billing/store/status?workspace=${workspace}`, { token: admin });
      expect(status.status).toBe(200);
      const statusBody = (await status.json()) as { subscription: { subscribed: boolean; plan: string } };
      expect(statusBody.subscription).toMatchObject({ subscribed: true, plan: "team" });
    } finally {
      restoreEnv(saved);
    }
  });

  it("refuses a second paid grant on the same workspace", async () => {
    const saved = saveEnv();
    try {
      setApple(await ecPrivateKeyPem());
      setGoogle(await rsaPrivateKeyPem());
      const admin = await signIn(`store-admin-${serial}@example.test`);
      const web = slug("web");
      await call("/api/auth/signup", { method: "POST", token: admin, body: { workspace: web, plan: "business" } });
      const store = slug("store");
      await call("/api/auth/signup", { method: "POST", token: admin, body: { workspace: store } });

      vi.stubGlobal("fetch", async () => {
        throw new Error("no store reads on a refused grant");
      });

      // A web-paid workspace cannot add a store subscription.
      const webAttempt = await call("/api/billing/store/verify", {
        method: "POST",
        token: admin,
        body: { workspace: web, platform: "apple", receipt: "tx-x" },
      });
      expect(webAttempt.status).toBe(409);

      // A store grant refuses the other platform afterwards. Seed the
      // Apple row directly (the Apple API is stubbed to throw).
      await env.DB.prepare(
        "INSERT INTO store_subscriptions (workspace_id, platform, product_id, transaction_id, status, expires_at, updated_at) VALUES (?, 'apple', 'maximus_plus_monthly', 'orig-9', 'active', ?, ?)",
      ).bind(store, Date.now() + 1000, Date.now()).run();
      const crossAttempt = await call("/api/billing/store/verify", {
        method: "POST",
        token: admin,
        body: {
          workspace: store,
          platform: "google",
          receipt: JSON.stringify({ purchaseToken: "tok", productId: "maximus_plus_monthly" }),
        },
      });
      expect(crossAttempt.status).toBe(409);
    } finally {
      restoreEnv(saved);
    }
  });

  it("fails closed without credentials and rejects bad receipts", async () => {
    const saved = saveEnv();
    try {
      restoreEnv({ ...saveEnv(), APPSTORE_ISSUER_ID: undefined });
      const admin = await signIn(`store-admin-${serial}@example.test`);
      const workspace = slug("ws");
      await call("/api/auth/signup", { method: "POST", token: admin, body: { workspace } });

      const missing = await call("/api/billing/store/verify", {
        method: "POST",
        token: admin,
        body: { workspace, platform: "apple", receipt: "tx-1" },
      });
      expect(missing.status).toBe(503);

      setApple(await ecPrivateKeyPem());
      const malformed = await call("/api/billing/store/verify", {
        method: "POST",
        token: admin,
        body: { workspace, platform: "apple", receipt: "not a receipt!!" },
      });
      expect(malformed.status).toBe(400);

      vi.stubGlobal("fetch", async () => new Response("nope", { status: 404 }));
      const unknown = await call("/api/billing/store/verify", {
        method: "POST",
        token: admin,
        body: { workspace, platform: "apple", receipt: "tx-missing" },
      });
      expect(unknown.status).toBe(400);
    } finally {
      restoreEnv(saved);
    }
  });

  it("verifies a Google purchase and acknowledges it", async () => {
    const saved = saveEnv();
    try {
      setGoogle(await rsaPrivateKeyPem());
      const admin = await signIn(`store-admin-${serial}@example.test`);
      const workspace = slug("ws");
      await call("/api/auth/signup", { method: "POST", token: admin, body: { workspace } });

      const expiry = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
      const calls: string[] = [];
      vi.stubGlobal("fetch", async (url: unknown, init?: { method?: string }) => {
        const href = String(url);
        calls.push(`${init?.method ?? "GET"} ${href}`);
        if (href.includes("oauth2.googleapis.com")) return Response.json({ access_token: "tok" });
        if (href.includes(":acknowledge")) return Response.json({});
        if (href.includes("purchases/subscriptionsv2/")) {
          return Response.json({
            lineItems: [{ productId: "maximus_pro_monthly", expiryTime: expiry }],
            acknowledgementState: "PENDING",
          });
        }
        throw new Error(`unexpected fetch ${href}`);
      });

      const verify = await call("/api/billing/store/verify", {
        method: "POST",
        token: admin,
        body: {
          workspace,
          platform: "google",
          receipt: JSON.stringify({ purchaseToken: "purchase-1", productId: "maximus_pro_monthly" }),
        },
      });
      expect(verify.status).toBe(200);
      const granted = (await verify.json()) as { subscription: { plan: string } };
      expect(granted.subscription.plan).toBe("business");
      expect(calls.some((call) => call.includes(":acknowledge"))).toBe(true);
    } finally {
      restoreEnv(saved);
    }
  });

  it("applies Apple renewals and expiries from server notifications", async () => {
    const saved = saveEnv();
    try {
      setApple(await ecPrivateKeyPem());
      const admin = await signIn(`store-admin-${serial}@example.test`);
      const workspace = slug("ws");
      await call("/api/auth/signup", { method: "POST", token: admin, body: { workspace } });
      await env.DB.prepare(
        "INSERT INTO store_subscriptions (workspace_id, platform, product_id, transaction_id, status, expires_at, updated_at) VALUES (?, 'apple', 'maximus_plus_monthly', 'orig-2', 'active', ?, ?)",
      ).bind(workspace, Date.now() + 1000, Date.now()).run();

      let txPayload: Record<string, unknown> = {
        transactionId: "tx-2",
        originalTransactionId: "orig-2",
        productId: "maximus_plus_monthly",
        expiresDate: Date.now() + 60 * 24 * 3600_000,
      };
      vi.stubGlobal("fetch", async (url: unknown) => {
        if (String(url).includes("/inApps/v1/transactions/")) {
          return Response.json({ signedTransactionInfo: jws(txPayload) });
        }
        throw new Error(`unexpected fetch ${String(url)}`);
      });
      const notify = (type: string, uuid: string) =>
        call("/api/billing/webhook/apple", {
          method: "POST",
          body: {
            signedPayload: jws({
              notificationType: type,
              notificationUUID: uuid,
              data: { signedTransactionInfo: jws(txPayload) },
            }),
          },
        });

      const renewed = await notify("DID_RENEW", "uuid-renew-1");
      expect(renewed.status).toBe(200);

      txPayload = { ...txPayload, transactionId: "tx-3", expiresDate: Date.now() - 1000 };
      const expired = await notify("EXPIRED", "uuid-expire-1");
      expect(expired.status).toBe(200);
      const row = await env.DB.prepare("SELECT status FROM store_subscriptions WHERE workspace_id = ?")
        .bind(workspace)
        .first<{ status: string }>();
      expect(row?.status).toBe("expired");
      const ws = await env.DB.prepare("SELECT status, plan FROM workspaces WHERE id = ?")
        .bind(workspace)
        .first<{ status: string; plan: string }>();
      expect(ws?.status).toBe("grace");
    } finally {
      restoreEnv(saved);
    }
  });

  it("applies Google renewals and cancels from RTDN", async () => {
    const saved = saveEnv();
    try {
      setGoogle(await rsaPrivateKeyPem());
      const admin = await signIn(`store-admin-${serial}@example.test`);
      const workspace = slug("ws");
      await call("/api/auth/signup", { method: "POST", token: admin, body: { workspace } });
      await env.DB.prepare(
        "INSERT INTO store_subscriptions (workspace_id, platform, product_id, transaction_id, status, expires_at, updated_at) VALUES (?, 'google', 'maximus_plus_monthly', 'purchase-2', 'active', ?, ?)",
      ).bind(workspace, Date.now() + 1000, Date.now()).run();

      vi.stubGlobal("fetch", async (url: unknown) => {
        const href = String(url);
        if (href.includes("oauth2.googleapis.com")) return Response.json({ access_token: "tok" });
        if (href.includes("purchases/subscriptionsv2/")) {
          return Response.json({
            lineItems: [{ productId: "maximus_plus_monthly", expiryTime: new Date(Date.now() + 1000).toISOString() }],
            acknowledgementState: "ACKNOWLEDGED",
          });
        }
        throw new Error(`unexpected fetch ${href}`);
      });
      const push = (type: number, messageId: string, secret: string) => {
        const data = btoa(JSON.stringify({ subscriptionNotification: { notificationType: type, purchaseToken: "purchase-2" } }));
        return call("/api/billing/webhook/google", {
          method: "POST",
          query: `?secret=${secret}`,
          body: { message: { messageId, data } },
        });
      };

      expect((await push(2, "msg-1", "wrong")).status).toBe(401);
      expect((await push(2, "msg-1", "rtdn-secret")).status).toBe(200);
      expect((await push(3, "msg-2", "rtdn-secret")).status).toBe(200);
      const row = await env.DB.prepare("SELECT status FROM store_subscriptions WHERE workspace_id = ?")
        .bind(workspace)
        .first<{ status: string }>();
      expect(row?.status).toBe("expired");
    } finally {
      restoreEnv(saved);
    }
  });

  it("keeps store reads to members and writes to admins", async () => {
    const saved = saveEnv();
    try {
      setApple(await ecPrivateKeyPem());
      const admin = await signIn(`store-admin-${serial}@example.test`);
      const workspace = slug("ws");
      await call("/api/auth/signup", { method: "POST", token: admin, body: { workspace } });
      const invited = await call("/api/auth/invite", {
        method: "POST",
        token: admin,
        body: { workspace, email: `store-member-${serial}@example.test`, role: "member" },
      });
      const { token: inviteToken } = (await invited.json()) as { token: string };
      const member = await signIn(`store-member-${serial}@example.test`);
      await call("/api/auth/invite/accept", { method: "POST", token: member, body: { token: inviteToken } });

      const memberStatus = await call(`/api/billing/store/status?workspace=${workspace}`, { token: member });
      expect(memberStatus.status).toBe(200);

      vi.stubGlobal("fetch", async () => {
        throw new Error("members never reach the store");
      });
      const memberVerify = await call("/api/billing/store/verify", {
        method: "POST",
        token: member,
        body: { workspace, platform: "apple", receipt: "tx-1" },
      });
      expect(memberVerify.status).toBe(403);
    } finally {
      restoreEnv(saved);
    }
  });
});
