import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createFcmSender, credentialsFromEnv } from "./mobile-push-fcm.ts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const CREDENTIALS = {
  projectId: "maximus-test",
  clientEmail: "push@maximus-test.iam.gserviceaccount.com",
  privateKey: PRIVATE_KEY,
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("FCM sender", () => {
  it("reads credentials from env, tolerating escaped newlines", () => {
    expect(credentialsFromEnv({})).toBeNull();
    expect(credentialsFromEnv({
      MAXIMUS_FCM_PROJECT_ID: "p",
      MAXIMUS_FCM_CLIENT_EMAIL: "e",
      MAXIMUS_FCM_PRIVATE_KEY: "line1\\nline2",
    })).toEqual({ projectId: "p", clientEmail: "e", privateKey: "line1\nline2" });
  });

  it("exchanges a signed JWT for an access token, then sends", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("oauth2")) return jsonResponse({ access_token: "tok", expires_in: 3600 });
      return jsonResponse({ name: "projects/p/messages/m1" });
    });
    const sender = createFcmSender({ credentials: CREDENTIALS, fetchImpl: fetchImpl as typeof fetch });
    const result = await sender.send({
      token: "device-token",
      title: "Hi",
      body: "there",
      data: { threadId: "t1" },
      collapseKey: "t1",
      highPriority: true,
    });
    expect(result).toEqual({ ok: true, messageId: "projects/p/messages/m1" });
    expect(calls).toHaveLength(2);
    // The OAuth grant carries a three-part JWT.
    const grant = new URLSearchParams(calls[0]!.init.body as string);
    expect(grant.get("assertion")!.split(".")).toHaveLength(3);
    // The send mirrors collapse + priority down both platform paths.
    expect(calls[1]!.url).toContain("/v1/projects/maximus-test/messages:send");
    const payload = JSON.parse(calls[1]!.init.body as string);
    expect(payload.message).toMatchObject({
      token: "device-token",
      android: { priority: "HIGH", collapse_key: "t1" },
      apns: { headers: { "apns-priority": "10", "apns-collapse-id": "t1" } },
    });
  });

  it("caches the access token across sends", async () => {
    let oauthCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("oauth2")) {
        oauthCalls += 1;
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      return jsonResponse({ name: "m" });
    });
    const sender = createFcmSender({ credentials: CREDENTIALS, fetchImpl: fetchImpl as typeof fetch });
    const message = { token: "t", title: "", body: "", data: {}, collapseKey: "c", highPriority: false };
    await sender.send(message);
    await sender.send(message);
    expect(oauthCalls).toBe(1);
  });

  it("flags dead tokens, keeps the rest", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("oauth2")) return jsonResponse({ access_token: "tok", expires_in: 3600 });
      return jsonResponse({ error: { status: "UNREGISTERED", message: "gone" } }, 404);
    });
    const sender = createFcmSender({ credentials: CREDENTIALS, fetchImpl: fetchImpl as typeof fetch });
    const result = await sender.send({ token: "dead", title: "", body: "", data: {}, collapseKey: "c", highPriority: false });
    expect(result).toEqual({ ok: false, error: "gone", deadToken: true });
  });

  it("reports a failed OAuth exchange without throwing", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "nope" }, 401));
    const sender = createFcmSender({ credentials: CREDENTIALS, fetchImpl: fetchImpl as typeof fetch });
    const result = await sender.send({ token: "t", title: "", body: "", data: {}, collapseKey: "c", highPriority: false });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ deadToken: false });
  });

  it("sends validate_only for dry runs", async () => {
    let payload: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("oauth2")) return jsonResponse({ access_token: "tok", expires_in: 3600 });
      payload = JSON.parse(init!.body as string) as Record<string, unknown>;
      return jsonResponse({ name: "m" });
    });
    const sender = createFcmSender({ credentials: CREDENTIALS, fetchImpl: fetchImpl as typeof fetch });
    await sender.send({ token: "t", title: "", body: "", data: {}, collapseKey: "c", highPriority: false, dryRun: true });
    expect(payload.validate_only).toBe(true);
  });
});
