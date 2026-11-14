import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { koboFromUsd, nairaFromUsd, nigeriaFromSignals, PaymentStore } from "./payments.ts";

describe("Nigeria Paystack pricing", () => {
  it("converts a dollar price to naira and kobo at the admin rate", () => {
    expect(nairaFromUsd(19, 1600)).toBe(30400);
    expect(koboFromUsd(19, 1600)).toBe(3_040_000);
    expect(nairaFromUsd(0, 1600)).toBe(0);
  });

  it("treats a Cloudflare NG header as Nigeria and ignores a Lagos timezone behind another country", () => {
    expect(nigeriaFromSignals({ countryHeader: "NG", timeZone: "Europe/London" })).toBe(true);
    expect(nigeriaFromSignals({ countryHeader: "US", timeZone: "Africa/Lagos" })).toBe(false);
    expect(nigeriaFromSignals({ timeZone: "Africa/Lagos" })).toBe(true);
    expect(nigeriaFromSignals({ timeZone: "WAT" })).toBe(true);
    expect(nigeriaFromSignals({ timeZone: "Europe/London" })).toBe(false);
  });

  it("saves the admin switch", () => {
    const store = new PaymentStore(mkdtempSync(join(tmpdir(), "payments-")));
    expect(store.read().paystackEnabled).toBe(false);
    expect(store.save({ paystackEnabled: true, bachsEnabled: false, ngnPerUsd: 1550 })).toBeNull();
    expect(store.read()).toEqual({ paystackEnabled: true, bachsEnabled: false, ngnPerUsd: 1550 });
    expect(store.save({ paystackEnabled: true, bachsEnabled: false, ngnPerUsd: 0 })).toBeTruthy();
  });
});
