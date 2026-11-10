import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ConnectView,
  planDisplayName,
  ProvidersView,
  spendLine,
  toEntitlementView,
  toSeatViews,
  toSpendView,
} from "./WorkspaceAccountSection";

describe("workspace account views", () => {
  it("narrows worker payloads and drops malformed rows", () => {
    expect(toEntitlementView({ entitlements: { plan: "team", granted: ["admin", 7], status: "active", banner: null } }))
      .toEqual({ plan: "team", granted: ["admin"], status: "active", banner: null });
    expect(toEntitlementView({ entitlements: { plan: "team" } })).toBeNull();
    expect(toSpendView({ spend: { period: "2026-11", spent: 1250, allowance: 200000, remaining: 198750, overage: 0 } }))
      .toMatchObject({ period: "2026-11", spent: 1250, allowance: 200000 });
    expect(toSpendView({})).toBeNull();
    const seats = toSeatViews({
      seats: {
        roster: [{ userId: "u1", email: "ada@example.com", role: "admin" }, { nope: true }],
        invites: [{ id: "i1", email: "bob@example.com", role: "member" }],
      },
    });
    expect(seats.members).toEqual([{ userId: "u1", email: "ada@example.com", name: "", role: "admin" }]);
    expect(seats.invites).toEqual([{ id: "i1", email: "bob@example.com", role: "member" }]);
  });

  it("phrases spend and plan names from catalog data", () => {
    expect(spendLine({ period: "2026-11", spent: 1250, allowance: 200000, remaining: 198750, overage: 0 })).toContain("of");
    expect(spendLine({ period: "2026-11", spent: 0, allowance: null, remaining: null, overage: 0 })).toContain("own logins");
    expect(planDisplayName("team", [{ id: "team", name: "Team", blurb: "", baseUsd: 20, allowanceUsd: 20, hardCapUsd: null, entitlements: [], features: [] }])).toBe("Team");
    expect(planDisplayName("custom", [])).toBe("custom");
  });

  it("renders connect and provider views", () => {
    const noop = (): void => undefined;
    const connect = renderToStaticMarkup(createElement(ConnectView, {
      busy: false, error: null, sent: false, email: "", code: "",
      onEmail: noop, onCode: noop, onSend: noop, onVerify: noop,
    }));
    expect(connect).toContain("console-account-email");
    const sent = renderToStaticMarkup(createElement(ConnectView, {
      busy: false, error: null, sent: true, email: "ada@example.com", code: "",
      onEmail: noop, onCode: noop, onSend: noop, onVerify: noop,
    }));
    expect(sent).toContain("ada@example.com");
    const providers = renderToStaticMarkup(createElement(ProvidersView, {
      providers: [{ id: "kimi", mode: "bundled", models: ["kimi-k3"], reason: "Runs on bundled usage" }],
      admin: true,
      busy: false,
      onMode: noop,
    }));
    expect(providers).toContain("kimi");
    expect(providers).toContain("bundled usage");
    expect(renderToStaticMarkup(createElement(ProvidersView, { providers: [], admin: true, busy: false, onMode: noop }))).toBe("");
  });

  it("never mentions admin in account copy", () => {
    const noop = (): void => undefined;
    const member = renderToStaticMarkup(createElement(ProvidersView, {
      providers: [{ id: "kimi", mode: "byo", models: [], reason: "" }],
      admin: false,
      busy: false,
      onMode: noop,
    }));
    expect(member).toContain("Only workspace owners can change this.");
    expect(member.replace(/<[^>]*>/g, " ")).not.toMatch(/admin/i);
  });
});
