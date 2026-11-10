import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { bannerTone, BillingBannerView } from "./BillingBanner";

describe("billing banner", () => {
  it("is silent without a banner", () => {
    expect(bannerTone(null)).toBeNull();
    expect(renderToStaticMarkup(createElement(BillingBannerView, { banner: null }))).toBe("");
  });

  it("warns during grace and alarms when suspended", () => {
    expect(bannerTone({ kind: "grace", title: "t", body: "b" })).toBe("warning");
    expect(bannerTone({ kind: "suspended", title: "t", body: "b" })).toBe("danger");
    const grace = renderToStaticMarkup(createElement(BillingBannerView, {
      banner: { kind: "grace", title: "Payment needs attention", body: "Update payment to stay on maximus-pro." },
    }));
    expect(grace).toContain('role="status"');
    expect(grace).toContain("Payment needs attention");
    const suspended = renderToStaticMarkup(createElement(BillingBannerView, {
      banner: { kind: "suspended", title: "Subscription ended — free tier", body: "No workspace data was removed." },
    }));
    expect(suspended).toContain("bg-danger/10");
    expect(suspended).toContain("No workspace data was removed");
  });
});
