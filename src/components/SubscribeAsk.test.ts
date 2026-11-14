// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SubscribeAsk } from "./SubscribeAsk";

const plans = {
  plans: [
    { id: "free", name: "Free", blurb: "A one-time Muse grant.", baseUsd: 0, allowanceUsd: 0.012, hardCapUsd: null, entitlements: [], features: [] },
    { id: "byo", name: "Your model", blurb: "Bring your own LLM key.", baseUsd: 9, allowanceUsd: 0, hardCapUsd: null, entitlements: [], features: [] },
  ],
};

let offerGate: () => void = () => {};
let offerReady = Promise.resolve();
const opened: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage?.clear();
  window.sessionStorage?.clear();
  opened.length = 0;
  offerReady = new Promise<void>((resolve) => { offerGate = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/auth/session")) return json({ kind: "session", id: "s", email: "ada@example.com", scopes: ["client"], expiresAt: 1 });
    if (url.includes("/api/account/plan")) return json({ choice: null });
    if (url.includes("/api/console/plans")) return json(plans);
    if (url.includes("/api/billing/offer")) {
      await offerReady;
      return json({ offer: { currency: "USD", provider: "bachs", paystackEnabled: false, bachsEnabled: true, ngnPerUsd: 1600 } });
    }
    if (url.includes("/api/billing/checkout")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { provider?: string; plan?: string };
      opened.push(`${body.provider}:${body.plan}`);
      return json({ checkout: { url: "https://checkout.bachs.io/pay/fixture" } });
    }
    return json({ error: `unmapped ${url}` }, 404);
  }));
});

afterEach(() => {
  offerGate();
  vi.unstubAllGlobals();
});

async function show(root: Root, host: HTMLDivElement): Promise<void> {
  await act(async () => { root.render(createElement(SubscribeAsk)); });
  await act(async () => {
    await vi.waitFor(() => {
      if (!host.textContent?.includes("Your model")) throw new Error("plans have not arrived");
    });
  });
  expect(host.textContent).not.toContain("Pay with Bachs");
  await act(async () => { offerGate(); });
  await act(async () => {
    await vi.waitFor(() => {
      if (!host.textContent?.includes("Pay with Bachs")) throw new Error("the pay button did not appear");
    });
  });
}

describe("SubscribeAsk", () => {
  it("keeps a pay button after the plan list arrives first, and opens checkout outside the desktop window", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const openExternal = vi.fn(async () => {});
    (window as unknown as { ogb: { openExternal: typeof openExternal } }).ogb = { openExternal };
    await show(root, host);
    expect(host.textContent).toContain("Pay with Bachs");
    const pay = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Your model"));
    expect(pay).toBeTruthy();
    await act(async () => { pay?.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(opened).toEqual(["bachs:byo"]);
    expect(openExternal).toHaveBeenCalledWith("https://checkout.bachs.io/pay/fixture");
    await act(async () => { root.unmount(); });
    host.remove();
  });
});
