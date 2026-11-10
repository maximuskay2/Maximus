import { useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";

import { productName } from "../lib/brand";
import { t } from "../lib/i18n";
import { MaximusMark } from "./MaximusMark";

// Public site palette. Dark canvas so marketing reads the same for every visitor
// and does not inherit the app skin.
export const site = {
  paper: "bg-[#070708]",
  ink: "text-[#F4F1EA]",
  muted: "text-[#A39E93]",
  faint: "text-[#6F685E]",
  hairline: "border-white/10",
  accent: "bg-[#C2410C]",
  accentHover: "hover:bg-[#A5360A]",
  accentText: "text-[#E86A3A]",
  dark: "bg-[#101012]",
  darkInk: "text-[#F4F1EA]",
  darkMuted: "text-[#A39E93]",
  darkHairline: "border-white/10",
};

type NavKey = "console.site.navFeatures" | "console.site.navTour" | "console.site.navPricing" | "console.site.navDownload" | "console.pricing.enterpriseTitle" | "console.site.signIn" | "console.site.getStarted";

const PRODUCT_LINKS: { href: string; labelKey: NavKey }[] = [
  { href: "/welcome#features", labelKey: "console.site.navFeatures" },
  { href: "/welcome#tour", labelKey: "console.site.navTour" },
  { href: "/welcome#download", labelKey: "console.site.navDownload" },
];

const PRICING_LINKS: { href: string; labelKey: NavKey }[] = [
  { href: "/pricing", labelKey: "console.site.navPricing" },
  { href: "/pricing#enterprise", labelKey: "console.pricing.enterpriseTitle" },
];

const ACCOUNT_LINKS: { href: string; labelKey: NavKey }[] = [
  { href: "/signin", labelKey: "console.site.signIn" },
  { href: "/signup", labelKey: "console.site.getStarted" },
];

// Keyboard focus fades the link into the ember CTA color instead of an outline.
const navFocus = "transition-colors focus-visible:bg-[#C2410C] focus-visible:text-white focus-visible:outline-none";

function NavMenu({ label, links, open, onOpen, onClose, onToggle }: { label: string; links: { href: string; labelKey: NavKey }[]; open: boolean; onOpen: () => void; onClose: () => void; onToggle: () => void }) {
  return (
    <div className="group relative" onMouseEnter={onOpen} onMouseLeave={onClose}>
      <button
        type="button"
        className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[14px] text-[#C9C2B2] hover:text-white ${navFocus}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={onToggle}
      >
        {label}
        <ChevronDown size={14} aria-hidden className={`transition duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <div className={`absolute left-0 top-full z-50 w-56 pt-2 transition duration-200 ${open ? "visible opacity-100" : "invisible opacity-0"} group-focus-within:visible group-focus-within:opacity-100`}>
        <div className="site-menu rounded-2xl border border-white/15 bg-[#1c1c22] p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`block rounded-xl px-3 py-2.5 text-[14px] font-medium text-[#F4F1EA] no-underline hover:bg-white/10 ${navFocus}`}
            >
              {t(link.labelKey)}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<"product" | "pricing" | "account" | null>(null);
  const close = () => setOpen(false);
  const toggle = (name: "product" | "pricing" | "account") => setMenu((current) => (current === name ? null : name));
  const show = (name: "product" | "pricing" | "account") => setMenu(name);
  const hide = (name: "product" | "pricing" | "account") => setMenu((current) => (current === name ? null : current));
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070708]/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center gap-2 px-5">
        <a href="/welcome" className="flex items-center gap-2 text-[16px] font-semibold tracking-tight text-white no-underline">
          <MaximusMark size={28} />
          {productName()}
        </a>
        <nav aria-label={t("console.site.nav")} className="ml-4 hidden items-center gap-1 md:flex">
          <NavMenu label={t("console.site.footerProduct")} links={PRODUCT_LINKS} open={menu === "product"} onOpen={() => show("product")} onClose={() => hide("product")} onToggle={() => toggle("product")} />
          <NavMenu label={t("console.site.navPricing")} links={PRICING_LINKS} open={menu === "pricing"} onOpen={() => show("pricing")} onClose={() => hide("pricing")} onToggle={() => toggle("pricing")} />
          <NavMenu label={t("console.site.footerAccount")} links={ACCOUNT_LINKS} open={menu === "account"} onOpen={() => show("account")} onClose={() => hide("account")} onToggle={() => toggle("account")} />
        </nav>
        <span className="flex-1" />
        <a href="/signin" className={`hidden rounded-full px-3 py-1.5 text-[14px] text-[#C9C2B2] no-underline hover:text-white sm:block ${navFocus}`}>
          {t("console.site.signIn")}
        </a>
        <a
          href="/signup"
          className="hidden rounded-full bg-white px-4 py-2 text-[14px] font-medium text-[#111] no-underline transition hover:bg-[#F4F1EA] sm:block"
        >
          {t("console.site.getStarted")}
        </a>
        <button
          type="button"
          className={`rounded-full p-2 text-[#C9C2B2] hover:text-white md:hidden ${navFocus}`}
          aria-label={open ? t("console.dashboard.close") : t("console.dashboard.openNav")}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open && (
        <nav aria-label={t("console.site.nav")} className="site-menu border-t border-white/10 bg-[#070708] px-4 py-3 md:hidden">
          {[
            { title: t("console.site.footerProduct"), links: PRODUCT_LINKS },
            { title: t("console.site.navPricing"), links: PRICING_LINKS },
            { title: t("console.site.footerAccount"), links: ACCOUNT_LINKS },
          ].map((group) => (
            <div key={group.title} className="py-2">
              <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6F685E]">{group.title}</p>
              <div className="mt-1 flex flex-col">
                {group.links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className={`rounded-xl px-2 py-2.5 text-[15px] text-[#F4F1EA] no-underline hover:bg-white/5 ${navFocus}`}
                    onClick={close}
                  >
                    {t(link.labelKey)}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  const group = "text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6F685E]";
  const link = "text-[14px] text-[#A39E93] no-underline transition-colors hover:text-white";
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto grid w-full max-w-[1120px] gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-1">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-white">
            <MaximusMark size={22} />
            {productName()}
          </p>
          <p className={`mt-3 max-w-[240px] text-[13px] leading-relaxed ${site.muted}`}>{t("console.site.footerTag")}</p>
        </div>
        <nav aria-label={t("console.site.footerProduct")}>
          <p className={group}>{t("console.site.footerProduct")}</p>
          <ul className="mt-3 space-y-2">
            {PRODUCT_LINKS.map((item) => (
              <li key={item.href}><a className={link} href={item.href}>{t(item.labelKey)}</a></li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t("console.site.navPricing")}>
          <p className={group}>{t("console.site.navPricing")}</p>
          <ul className="mt-3 space-y-2">
            {PRICING_LINKS.map((item) => (
              <li key={item.href}><a className={link} href={item.href}>{t(item.labelKey)}</a></li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t("console.site.footerAccount")}>
          <p className={group}>{t("console.site.footerAccount")}</p>
          <ul className="mt-3 space-y-2">
            <li><a className={link} href="/signup">{t("console.site.tourSignup")}</a></li>
            <li><a className={link} href="/signin">{t("console.site.tourSignin")}</a></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/10">
        <div className={`mx-auto flex w-full max-w-[1120px] flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 text-[13px] ${site.faint}`}>
          <span>© {year} {productName()}</span>
          <span aria-hidden>·</span>
          <span>{t("console.site.footerPlatforms")}</span>
        </div>
      </div>
    </footer>
  );
}

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={`relative flex min-h-screen flex-col ${site.paper} ${site.ink} antialiased`}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[640px] overflow-hidden">
        <div className="site-glow absolute left-1/2 top-[-160px] h-[460px] w-[760px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(194,65,12,0.38),transparent_68%)] blur-2xl" />
        <div className="site-glow absolute left-[12%] top-[80px] h-[280px] w-[320px] rounded-full bg-[radial-gradient(circle,rgba(59,91,219,0.32),transparent_70%)] blur-3xl [animation-delay:-5s]" />
      </div>
      <SiteHeader />
      <div className="relative flex flex-1 flex-col">{children}</div>
      <SiteFooter />
    </div>
  );
}
