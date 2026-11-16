import { describe, expect, it } from "vitest";

import { isFcmPlatform } from "./fcm.ts";

describe("FCM platforms", () => {
  it("accepts phones, browsers and the desktop app", () => {
    expect(["ios", "android", "web", "desktop"].every(isFcmPlatform)).toBe(true);
    expect(isFcmPlatform("macos")).toBe(false);
  });
});
