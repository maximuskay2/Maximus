import { afterEach, describe, expect, it, vi } from "vitest";

import { applyGrantInstallHeader, grantInstallId } from "./install-id";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("grantInstallId", () => {
  it("reuses one id on the same profile", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    });
    const first = grantInstallId();
    expect(first).toMatch(/^[A-Za-z0-9._:-]{8,}$/);
    expect(grantInstallId()).toBe(first);
    const headers = new Headers();
    applyGrantInstallHeader(headers);
    expect(headers.get("x-maximus-install")).toBe(first);
    const plain: Record<string, string> = {};
    applyGrantInstallHeader(plain);
    expect(plain["x-maximus-install"]).toBe(first);
  });

  it("returns null when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    });
    expect(grantInstallId()).toBeNull();
    const headers = new Headers();
    applyGrantInstallHeader(headers);
    expect(headers.has("x-maximus-install")).toBe(false);
  });
});
