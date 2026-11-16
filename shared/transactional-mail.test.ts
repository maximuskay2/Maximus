import { describe, expect, it } from "vitest";

import { creditGrantMailParts, otpMailParts, passwordResetMailParts, signInCodeMailParts } from "./transactional-mail.ts";

describe("transactional mail", () => {
  it("builds a dark OTP card with the code and plain-text fallback", () => {
    const parts = otpMailParts("Your Maximus sign-in code", "12345678");
    expect(parts.subject).toBe("Your Maximus sign-in code");
    expect(parts.text).toContain("12345678");
    expect(parts.html).toContain("12345678");
    expect(parts.html).toContain("#e86a3a");
    expect(parts.html).toContain("Maximus");
    expect(parts.html).not.toContain("<script");
  });

  it("builds sign-in and password-reset mail with HTML and text", () => {
    const signIn = signInCodeMailParts("87654321");
    expect(signIn.text).toContain("8765 4321");
    expect(signIn.html).toContain("8765 4321");
    const reset = passwordResetMailParts("https://app.meetnote.cc/reset?token=abc");
    expect(reset.html).toContain("Choose a new password");
    expect(reset.html).toContain("https://app.meetnote.cc/reset?token=abc");
    expect(reset.text).toContain("https://app.meetnote.cc/reset?token=abc");
  });

  it("summarizes a credit grant without leaking markup from the note", () => {
    const parts = creditGrantMailParts({
      creditUsd: 5,
      tokens: 1000,
      plan: "plus",
      leftUsd: 27,
      note: `<script>alert(1)</script>`,
      appUrl: "https://app.meetnote.cc",
    });
    expect(parts.subject).toContain("$5.00");
    expect(parts.text).toContain("Credit added: $5.00");
    expect(parts.text).toContain("Plan: Plus");
    expect(parts.html).toContain("$5.00");
    expect(parts.html).toContain("Open Maximus");
    expect(parts.html).toContain("&lt;script&gt;");
    expect(parts.html).not.toContain("<script>alert");
  });
});
