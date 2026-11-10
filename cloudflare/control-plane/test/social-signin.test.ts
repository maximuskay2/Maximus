import { describe, expect, it } from "vitest";

import { configuredSocialSignIn, socialHandoffLocation } from "../src/auth";

describe("hosted social sign-in", () => {
  it("lists a provider only when both the client id and the secret are set", () => {
    const env = {
      GITHUB_CLIENT_ID: "gh",
      GITHUB_CLIENT_SECRET: "secret",
      GOOGLE_CLIENT_ID: "only-the-id",
    } as unknown as Env;
    expect(configuredSocialSignIn(env)).toEqual([{ id: "github", label: "GitHub" }]);
  });

  it("puts the account token in the sign-in fragment and nowhere else", () => {
    const allowed = new Set(["https://app.example"]);
    const next = socialHandoffLocation("https://app.example/signin?next=%2Fadmin", "signed.token", "ada@example.com", allowed);
    expect(next).toBe("https://app.example/signin?next=%2Fadmin#account=signed.token&email=ada%40example.com");
    expect(socialHandoffLocation("https://evil.example/signin", "signed.token", "ada@example.com", allowed)).toBeNull();
    expect(socialHandoffLocation("https://app.example/steal", "signed.token", "ada@example.com", allowed)).toBeNull();
  });
});
