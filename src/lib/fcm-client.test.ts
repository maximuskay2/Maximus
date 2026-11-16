import { afterEach, describe, expect, it, vi } from "vitest";

import { fcmRegistration, loadFirebaseWebConfig, registerFcmToken, unregisterFcmToken } from "./fcm-client";

const CONFIG = {
  apiKey: "AIzaDemo",
  projectId: "demo",
  messagingSenderId: "99",
  appId: "1:99:web:x",
  vapidKey: "vapid",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FCM client", () => {
  it("loads the public web config", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(CONFIG), { status: 200 }));
    await expect(loadFirebaseWebConfig(fetchImpl)).resolves.toEqual(CONFIG);
  });

  it("skips registration until notifications are granted", async () => {
    expect(await fcmRegistration({ permission: () => "default", fetchImpl: vi.fn() })).toBeNull();
  });

  it("uses the desktop token when this is the app", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(CONFIG), { status: 200 }));
    const got = await fcmRegistration({
      permission: () => "granted",
      fetchImpl,
      platform: () => "desktop",
      desktopToken: async (senderId) => senderId === "99" ? "desk-token" : null,
    });
    expect(got).toEqual({ token: "desk-token", platform: "desktop" });
  });

  it("falls back to the web token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(CONFIG), { status: 200 }));
    const got = await fcmRegistration({
      permission: () => "granted",
      fetchImpl,
      platform: () => "web",
      webToken: async () => "web-token",
    });
    expect(got).toEqual({ token: "web-token", platform: "web" });
  });

  it("registers and unregisters with the paired server", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("/register") && init?.method === "POST") {
        expect(JSON.parse(String(init?.body))).toMatchObject({ token: "t", platform: "web" });
        return new Response("{}", { status: 200 });
      }
      expect(init?.method).toBe("DELETE");
      return new Response("{}", { status: 200 });
    });
    await expect(registerFcmToken({ token: "t", platform: "web" }, { fetchImpl, version: "0.1.145" })).resolves.toBe(true);
    await unregisterFcmToken("t", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
