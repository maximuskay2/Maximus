import { describe, expect, it } from "vitest";

import { isProviderKeyPatch } from "./account-provider-keys.ts";

describe("a signed-in account's provider key", () => {
  it("accepts one provider secret and refuses every other setting", () => {
    expect(isProviderKeyPatch({ openai: { key: "sk-live" } })).toBe(true);
    expect(isProviderKeyPatch({ opencodeGo: { apiKey: "oc-live" } })).toBe(true);
    expect(isProviderKeyPatch({ openai: { key: "sk-live" }, xai: { key: "xai-live" } })).toBe(true);
    expect(isProviderKeyPatch({ openai: { key: "sk-live", url: "https://evil.example" } })).toBe(false);
    expect(isProviderKeyPatch({ openai: { key: "sk-live" }, signIn: { admins: ["a@b.c"] } })).toBe(false);
    expect(isProviderKeyPatch({ live: { key: "voice" } })).toBe(false);
    expect(isProviderKeyPatch({ openai: { key: "" } })).toBe(false);
    expect(isProviderKeyPatch({})).toBe(false);
    expect(isProviderKeyPatch(null)).toBe(false);
  });
});
