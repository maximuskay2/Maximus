// Copyright (c) 2026 Maximus. All rights reserved.
// Proprietary and confidential: licensed under the Maximus Enterprise License
// (maximus-enterprise/LICENSE), not the Apache License 2.0.
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { issueLicense, LICENSE_PUBLIC_KEYS, verifyLicense } from "./license.ts";
import { register } from "./server/index.ts";

function ephemeralKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeys: [publicKey.export({ format: "jwk" }).x as string],
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }) as string,
  };
}

const ISSUED = "2026-11-07";
const at = (iso: string) => new Date(iso).getTime();

describe("license gate matrix", () => {
  it("verifies a valid key and reports its claims", () => {
    const keys = ephemeralKeys();
    const key = issueLicense(
      { customer: "Acme", features: ["whitelabel", "admin"], issued: ISSUED, expires: "2027-11-07" },
      keys.privatePem,
    );
    expect(key.startsWith("max1.")).toBe(true);
    const verified = verifyLicense(key, { publicKeys: keys.publicKeys, now: at("2026-11-07T12:00:00Z") });
    expect(verified).toMatchObject({ customer: "Acme", features: ["whitelabel", "admin"], issued: ISSUED, expires: "2027-11-07" });
    expect(verified.inGrace).toBe(false);
    expect(verified.expiresInDays).toBe(365);
  });

  it("carries unknown feature ids instead of rejecting them", () => {
    const keys = ephemeralKeys();
    const key = issueLicense(
      { customer: "Acme", features: ["whitelabel", "not-shipped-yet"], issued: ISSUED, expires: null },
      keys.privatePem,
    );
    const verified = verifyLicense(key, { publicKeys: keys.publicKeys });
    expect(verified.features).toEqual(["whitelabel", "not-shipped-yet"]);
    expect(verified.expiresInDays).toBeNull();
    expect(verified.inGrace).toBe(false);
  });

  it("rejects keys with the wrong shape", () => {
    const keys = ephemeralKeys();
    for (const bad of ["", "omb1.a.b", "max1.", "max1.onlyone", "max1.a.b.c", "max1..sig", "max1.claims."]) {
      expect(() => verifyLicense(bad, { publicKeys: keys.publicKeys })).toThrow('expected "max1.<claims>.<signature>"');
    }
  });

  it("rejects keys whose claims are not well-formed", () => {
    const keys = ephemeralKeys();
    const signClaims = (claims: unknown): string => {
      const part = Buffer.from(typeof claims === "string" ? claims : JSON.stringify(claims), "utf8").toString("base64url");
      return `max1.${part}.${sign(null, Buffer.from(part, "utf8"), { key: keys.privatePem, format: "pem" }).toString("base64url")}`;
    };
    expect(() => verifyLicense(signClaims("not json"), { publicKeys: keys.publicKeys })).toThrow("invalid license claims");
    expect(() => verifyLicense(signClaims({ v: 2, customer: "x", features: [], issued: ISSUED, expires: null }), { publicKeys: keys.publicKeys })).toThrow("invalid license claims");
    for (const claims of [
      { v: 1, customer: "", features: [], issued: ISSUED, expires: null },
      { v: 1, customer: "x", features: "all", issued: ISSUED, expires: null },
      { v: 1, customer: "x", features: [""], issued: ISSUED, expires: null },
      { v: 1, customer: "x", features: [], issued: "2026-13-01", expires: null },
      { v: 1, customer: "x", features: [], issued: ISSUED, expires: "tomorrow" },
      { v: 1, customer: "x", features: [], issued: ISSUED },
    ]) {
      expect(() => verifyLicense(signClaims(claims), { publicKeys: keys.publicKeys })).toThrow("invalid license claims");
    }
  });

  it("rejects a tampered key as a signature mismatch", () => {
    const keys = ephemeralKeys();
    const key = issueLicense({ customer: "Acme", features: ["admin"], issued: ISSUED, expires: null }, keys.privatePem);
    const [, claims, signature] = key.split(".");
    const tamperedSig = signature.replace(/.$/, (last) => (last === "A" ? "B" : "A"));
    expect(() => verifyLicense(`max1.${claims}.${tamperedSig}`, { publicKeys: keys.publicKeys })).toThrow("signature does not match");
    const other = ephemeralKeys();
    expect(() => verifyLicense(key, { publicKeys: other.publicKeys })).toThrow("signature does not match");
  });

  it("refuses to verify when no public key is configured", () => {
    const keys = ephemeralKeys();
    const key = issueLicense({ customer: "Acme", features: [], issued: ISSUED, expires: null }, keys.privatePem);
    expect(() => verifyLicense(key, { publicKeys: [] })).toThrow("no license public key is configured");
  });

  it("ships a baked production public key", () => {
    expect(LICENSE_PUBLIC_KEYS.length).toBeGreaterThan(0);
    for (const key of LICENSE_PUBLIC_KEYS) expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("register()", () => {
  it("returns the layer shape core validates", async () => {
    const keys = ephemeralKeys();
    const key = issueLicense(
      { customer: "Acme", features: ["sso", "whitelabel", "sso"], issued: ISSUED, expires: "2027-01-01" },
      keys.privatePem,
    );
    await expect(register({ licenseKey: key, graceDays: 7, publicKeys: keys.publicKeys })).resolves.toEqual({
      customer: "Acme",
      features: ["sso", "whitelabel", "sso"],
      expiresAt: "2027-01-01",
    });
  });

  it("accepts an expired key inside the grace period and refuses it after", async () => {
    const keys = ephemeralKeys();
    const key = issueLicense(
      { customer: "Acme", features: ["sso"], issued: "2026-01-01", expires: "2027-01-01" },
      keys.privatePem,
    );
    const inGrace = register({ licenseKey: key, graceDays: 7, publicKeys: keys.publicKeys, now: at("2027-01-07T23:59:59Z") });
    await expect(inGrace).resolves.toMatchObject({ customer: "Acme", expiresAt: "2027-01-01" });
    await expect(register({ licenseKey: key, graceDays: 7, publicKeys: keys.publicKeys, now: at("2027-01-08T00:00:00Z") }))
      .rejects.toThrow("expired on 2027-01-01");
  });

  it("honours the grace period core asks for", async () => {
    const keys = ephemeralKeys();
    const key = issueLicense(
      { customer: "Acme", features: ["sso"], issued: "2026-01-01", expires: "2027-01-01" },
      keys.privatePem,
    );
    await expect(register({ licenseKey: key, graceDays: 0, publicKeys: keys.publicKeys, now: at("2027-01-01T00:00:01Z") }))
      .rejects.toThrow("expired on 2027-01-01");
    await expect(register({ licenseKey: key, graceDays: 30, publicKeys: keys.publicKeys, now: at("2027-01-20T00:00:00Z") }))
      .resolves.toMatchObject({ customer: "Acme" });
  });

  it("rejects a bogus key the way the docker smoke expects a refusal", async () => {
    await expect(register({ licenseKey: "max1.not.real", graceDays: 7, publicKeys: ephemeralKeys().publicKeys }))
      .rejects.toThrow("invalid license claims");
  });
});
