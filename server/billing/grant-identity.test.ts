import { describe, expect, it } from "vitest";

import { canonicalGrantEmail, grantInstallId } from "./grant-identity.ts";

describe("canonicalGrantEmail", () => {
  it("collapses Gmail dots, plus tags, and googlemail", () => {
    expect(canonicalGrantEmail("Ada.O+free2@Gmail.com")).toBe("adao@gmail.com");
    expect(canonicalGrantEmail("adao@googlemail.com")).toBe("adao@gmail.com");
    expect(canonicalGrantEmail("  Bob@Example.com ")).toBe("bob@example.com");
  });

  it("leaves a work mailbox's plus tag alone", () => {
    expect(canonicalGrantEmail("ada+billing@acme.com")).toBe("ada+billing@acme.com");
  });
});

describe("grantInstallId", () => {
  it("accepts a stable client id and drops junk", () => {
    expect(grantInstallId("phone-1abc")).toBe("phone-1abc");
    expect(grantInstallId("nope")).toBe("");
    expect(grantInstallId("bad id")).toBe("");
  });
});
