import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { browserLandingPath, scrollingDocument } from "./landing";
import { SiteShell } from "./SiteShell";
import { detectOs, DownloadCard, WelcomeView } from "./WelcomePage";

describe("marketing site", () => {
  it("opens the public site at the welcome page and leaves the desktop app at /", () => {
    expect(browserLandingPath("/", false)).toBe("/welcome");
    expect(browserLandingPath("/pricing", false)).toBeNull();
    expect(browserLandingPath("/", true)).toBeNull();
  });

  it("keeps a signed-in welcome on the fixed app viewport", () => {
    expect(scrollingDocument("/welcome", true)).toBe(false);
    expect(scrollingDocument("/welcome", false)).toBe(true);
    expect(scrollingDocument("/signin", false)).toBe(true);
    expect(scrollingDocument("/", true)).toBe(false);
  });

  it("shares one header and footer across pages", () => {
    const html = renderToStaticMarkup(createElement(SiteShell, null, "page"));
    for (const href of ["/welcome#features", "/welcome#tour", "/pricing", "/welcome#download", "/signin", "/signup", "/about", "/terms", "/privacy"]) {
      expect(html, href).toContain(`href="${href}"`);
    }
    expect(html).not.toContain("/admin");
    expect(html).toContain("page");
  });

  it("scrolls legal and password-reset pages like other marketing routes", () => {
    for (const path of ["/about", "/terms", "/privacy", "/forgot", "/reset"]) {
      expect(scrollingDocument(path, false)).toBe(true);
    }
  });

  it("gives the Features/Tour/Pricing/Download links a focus background", () => {
    const html = renderToStaticMarkup(createElement(SiteShell, null, "page"));
    for (const href of ["/welcome#features", "/welcome#tour", "/pricing", "/welcome#download"]) {
      const tag = html.match(new RegExp(`<a[^>]*href="${href.replace("/", "\\/")}"[^>]*>`))?.[0] ?? "";
      expect(tag, href).toContain("transition-colors");
      expect(tag, href).toContain("focus-visible:bg-[#C2410C]");
      expect(tag, href).toContain("focus-visible:text-white");
      expect(tag, href).toContain("focus-visible:outline-none");
    }
  });

  it("shows the Maximus mark in the header and footer", () => {
    const html = renderToStaticMarkup(createElement(SiteShell, null, "page"));
    expect(html.match(/src="\/bull-avatar.png"/g) ?? []).toHaveLength(2);
    expect(html.match(/bull-lid-left/g) ?? []).toHaveLength(2);
    expect(html.match(/bull-lid-right/g) ?? []).toHaveLength(2);
  });

  it("never mentions admin in marketing copy", () => {
    const shell = renderToStaticMarkup(createElement(SiteShell, null, "page"));
    const welcome = renderToStaticMarkup(createElement(WelcomeView));
    for (const html of [shell, welcome]) {
      expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(/admin/i);
    }
  });

  it("detects the visitor desktop OS and stays quiet on phones", () => {
    expect(detectOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36")).toBe("mac");
    expect(detectOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17 Safari/605.1.15")).toBe("mac");
    expect(detectOs("", "macOS")).toBe("mac");
    expect(detectOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36")).toBe("windows");
    expect(detectOs("", "Windows")).toBe("windows");
    expect(detectOs("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36")).toBe("linux");
    expect(detectOs("", "Linux x86_64")).toBe("linux");
    expect(detectOs("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36")).toBeNull();
    expect(detectOs("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17 Mobile/15E148 Safari/604.1")).toBeNull();
    expect(detectOs("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Version/17 Mobile/15E148 Safari/604.1")).toBeNull();
    expect(detectOs("")).toBeNull();
  });

  it("badges only the suggested download card", () => {
    const files = [{ os: "mac" as const, arch: "arm64", kind: "image" as const, file: "Maximus-0.1.144-arm64.dmg", bytes: 8 * 1024 * 1024 }];
    const suggested = renderToStaticMarkup(createElement(DownloadCard, { os: "mac", label: "macOS", note: "", files, suggested: true }));
    expect(suggested).toContain("Suggested for this device");
    expect(suggested).toContain("Maximus-0.1.144-arm64.dmg");
    const plain = renderToStaticMarkup(createElement(DownloadCard, { os: "mac", label: "macOS", note: "", files, suggested: false }));
    expect(plain).not.toContain("Suggested for this device");
    expect(plain).toContain("Maximus-0.1.144-arm64.dmg");
  });

  it("renders the hero, product visual, features, menu map, faq, and closing cta", () => {
    const html = renderToStaticMarkup(createElement(WelcomeView));
    for (const href of ["/signup", "/signin", "/pricing"]) {
      expect(html, href).toContain(`href="${href}"`);
    }
    expect(html).not.toContain("/admin");
    for (const name of ["Claude", "ChatGPT", "Grok", "Kimi", "Muse"]) {
      expect(html, name).toContain(name);
    }
    for (const anchor of ["id=\"features\"", "id=\"tour\"", "id=\"faq\"", "id=\"download\""]) {
      expect(html, anchor).toContain(anchor);
    }
    expect(html).toContain("<figure");
    expect(html).toContain("<details");
  });
});
