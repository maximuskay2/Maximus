import { useEffect, useState } from "react";
import { Check, Monitor, Smartphone, AppWindow } from "lucide-react";

import { productName } from "../lib/brand";
import { t } from "../lib/i18n";
import { isConnected, readSessionState } from "../lib/session";
import { SiteShell, site } from "../site/SiteShell";
import { consolePlans, formatUsd, type ConsolePlanView } from "./account";
import { ConsoleError as ErrorBox } from "./shell";

/** A signed-in person opens the app. Everyone else creates an account, carrying the plan they picked. */
export function planHref(planId: string, signedIn: boolean): string {
  if (signedIn) return "/";
  if (planId === "free") return "/signup";
  return `/signup?plan=${encodeURIComponent(planId)}`;
}

export function planAllowanceLine(plan: ConsolePlanView): string {
  if (plan.id === "free" && plan.allowanceUsd > 0) return t("console.pricing.freeGrant", { amount: formatUsd(plan.allowanceUsd) });
  if (plan.allowanceUsd > 0) return t("console.pricing.allowance", { amount: formatUsd(plan.allowanceUsd) });
  return t("console.pricing.byoOnly");
}

export function planPriceLine(plan: ConsolePlanView): string {
  if (plan.baseUsd <= 0) return t("console.free");
  return t("console.pricing.perMonth", { amount: formatUsd(plan.baseUsd) });
}

export function planFeatureUnion(plans: ConsolePlanView[]): string[] {
  const seen = new Set<string>();
  for (const plan of plans) {
    for (const feature of plan.features) {
      if (!seen.has(feature)) seen.add(feature);
    }
  }
  return [...seen];
}

export function CompareTable({ plans }: { plans: ConsolePlanView[] }) {
  const features = planFeatureUnion(plans);
  const cell = "px-4 py-3 align-top";
  const check = (on: boolean): React.ReactNode => (on
    ? <Check size={16} aria-label={t("console.pricing.yes")} className={site.accentText} />
    : <span aria-label={t("console.pricing.no")} className={site.faint}>—</span>);
  return (
    <div className="mt-8 overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
        <thead>
          <tr className={`border-b border-white/10 text-[13px] ${site.muted}`}>
            <th className={`${cell} font-medium`}><span className="sr-only">{t("console.pricing.details")}</span></th>
            {plans.map((plan) => (
              <th key={plan.id} className={`${cell} font-semibold text-[#F4F1EA]`}>{plan.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-white/10">
            <th scope="row" className={`${cell} font-medium ${site.muted}`}>{t("console.pricing.price")}</th>
            {plans.map((plan) => (
              <td key={plan.id} className={`${cell} font-medium`}>{planPriceLine(plan)}</td>
            ))}
          </tr>
          <tr className="border-b border-white/10">
            <th scope="row" className={`${cell} font-medium ${site.muted}`}>{t("console.pricing.includedUsage")}</th>
            {plans.map((plan) => (
              <td key={plan.id} className={cell}>{planAllowanceLine(plan)}</td>
            ))}
          </tr>
          <tr className="border-b border-white/10">
            <th scope="row" className={`${cell} font-medium ${site.muted}`}>{t("console.pricing.hardCap")}</th>
            {plans.map((plan) => (
              <td key={plan.id} className={cell}>{plan.hardCapUsd === null ? "—" : formatUsd(plan.hardCapUsd)}</td>
            ))}
          </tr>
          {features.map((feature) => (
            <tr key={feature} className="border-b border-white/10 last:border-0">
              <th scope="row" className={`${cell} font-normal ${site.muted}`}>{feature}</th>
              {plans.map((plan) => (
                <td key={plan.id} className={cell}>{check(plan.features.includes(feature))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PRICING_FAQS: { q: "console.pricing.faq1q" | "console.pricing.faq2q" | "console.pricing.faq3q" | "console.pricing.faq4q"; a: "console.pricing.faq1a" | "console.pricing.faq2a" | "console.pricing.faq3a" | "console.pricing.faq4a" }[] = [
  { q: "console.pricing.faq1q", a: "console.pricing.faq1a" },
  { q: "console.pricing.faq2q", a: "console.pricing.faq2a" },
  { q: "console.pricing.faq3q", a: "console.pricing.faq3a" },
  { q: "console.pricing.faq4q", a: "console.pricing.faq4a" },
];

const SURFACES: { icon: typeof AppWindow; title: "console.pricing.surfaceBrowser" | "console.pricing.surfaceDesktop" | "console.pricing.surfacePhone"; body: "console.pricing.surfaceBrowserBody" | "console.pricing.surfaceDesktopBody" | "console.pricing.surfacePhoneBody" }[] = [
  { icon: AppWindow, title: "console.pricing.surfaceBrowser", body: "console.pricing.surfaceBrowserBody" },
  { icon: Monitor, title: "console.pricing.surfaceDesktop", body: "console.pricing.surfaceDesktopBody" },
  { icon: Smartphone, title: "console.pricing.surfacePhone", body: "console.pricing.surfacePhoneBody" },
];

export function PricingView({ plans, error, signedIn = false, person = null }: { plans: ConsolePlanView[] | null; error: string | null; signedIn?: boolean; person?: string | null }) {
  const featured = plans?.find((plan) => plan.baseUsd > 0) ?? plans?.[0];
  const enter = signedIn ? t("console.pricing.openApp") : t("console.pricing.startFree");
  return (
    <SiteShell>
      <main className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-14">
        <h1 className="max-w-[680px] text-[34px] font-semibold leading-tight tracking-tight sm:text-[44px]">
          {t("console.pricing.title")}
        </h1>
        <p className={`mt-4 max-w-[600px] text-[16px] leading-relaxed ${site.muted}`}>{t("console.pricing.subtitle")}</p>
        {signedIn ? (
          <p className={`mt-4 max-w-[640px] text-[15px] ${site.ink}`}>{person ? t("console.pricing.signedIn", { person }) : t("console.pricing.signedInAnon")}</p>
        ) : (
          <p className="mt-4 text-[14px]">
            <a href="/signin" className={`${site.accentText} underline underline-offset-4`}>{t("console.pricing.haveAccount")}</a>
          </p>
        )}
        <section aria-labelledby="surfaces-heading" className="mt-10">
          <h2 id="surfaces-heading" className="text-[24px] font-semibold tracking-tight sm:text-[28px]">{t("console.pricing.surfacesTitle")}</h2>
          <p className={`mt-2 max-w-[640px] text-[15px] leading-relaxed ${site.muted}`}>{t("console.pricing.surfacesBody")}</p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {SURFACES.map((surface) => {
              const Icon = surface.icon;
              return (
                <a key={surface.title} href={signedIn ? "/" : "/signup"} className={`rounded-2xl border border-white/10 bg-white/[0.04] p-5 no-underline ${site.ink} transition duration-300 hover:-translate-y-1 hover:border-white/30`}>
                  <Icon size={18} aria-hidden className={site.accentText} />
                  <h3 className="mt-3 text-[16px] font-semibold">{t(surface.title)}</h3>
                  <p className={`mt-1 text-[14px] leading-relaxed ${site.muted}`}>{t(surface.body)}</p>
                  <p className={`mt-4 text-[13px] font-medium ${site.accentText}`}>{enter}</p>
                </a>
              );
            })}
          </div>
        </section>
        <ErrorBox message={error} />
        {plans === null && !error ? <p className={`mt-10 text-[15px] ${site.muted}`}>{t("console.loading")}</p> : null}
        {plans !== null && (
          <div className={`mt-10 grid gap-5 ${plans.length <= 1 ? "max-w-[420px] md:grid-cols-1" : plans.length === 2 ? "md:grid-cols-2" : "md:grid-cols-2 lg:grid-cols-3"}`}>
            {plans.map((plan) => {
              const hot = featured?.id === plan.id && plans.length > 1;
              return (
                <div
                  key={plan.id}
                  className={`site-rise flex flex-col rounded-2xl border p-6 transition duration-300 hover:-translate-y-1 ${hot ? "border-[#C2410C]/70 bg-[#16120E] shadow-[0_20px_60px_rgba(194,65,12,0.18)]" : "border-white/10 bg-white/[0.04] hover:border-white/25"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className={`text-[16px] font-semibold ${hot ? site.darkInk : ""}`}>{plan.name}</h2>
                    {hot && (
                      <span className={`rounded-full ${site.accent} px-2.5 py-0.5 text-[12px] font-medium text-white`}>
                        {t("console.pricing.popular")}
                      </span>
                    )}
                  </div>
                  {plan.blurb ? <p className={`mt-1 text-[13px] leading-relaxed ${hot ? site.darkMuted : site.muted}`}>{plan.blurb}</p> : null}
                  <p className={`mt-4 text-[32px] font-semibold tracking-tight ${hot ? site.darkInk : ""}`}>{planPriceLine(plan)}</p>
                  <p className={`mt-1 text-[13px] ${hot ? site.darkMuted : site.muted}`}>{planAllowanceLine(plan)}</p>
                  <ul className="mt-5 flex-1 space-y-2.5">
                    {plan.features.map((feature) => (
                      <li key={feature} className={`flex gap-2.5 text-[14px] leading-snug ${hot ? site.darkInk : ""}`}>
                        <Check size={16} aria-hidden className={`mt-0.5 shrink-0 ${hot ? "text-[#7FB685]" : site.accentText}`} />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <a
                    href={planHref(plan.id, signedIn)}
                    className={`mt-6 block rounded-md px-4 py-2.5 text-center text-[14px] font-medium no-underline ${
                      hot ? `${site.accent} ${site.accentHover} text-white` : "bg-[#1B1408] text-white hover:bg-[#000000]"
                    }`}
                  >
                    {signedIn ? t("console.pricing.openApp") : plan.id === "free" ? t("console.pricing.startFree") : t("console.pricing.choose")}
                  </a>
                </div>
              );
            })}
          </div>
        )}
        <p className={`mt-6 text-[13px] ${site.faint}`}>{t("console.pricing.usdNote")}</p>
        <section id="enterprise" aria-labelledby="enterprise-heading" className="relative mt-16 overflow-hidden rounded-3xl border border-white/10 bg-[#101012] px-6 py-10 sm:px-10">
          <h2 id="enterprise-heading" className={`text-[24px] font-semibold tracking-tight ${site.darkInk} sm:text-[28px]`}>{t("console.pricing.enterpriseTitle")}</h2>
          <p className={`mt-3 max-w-[640px] text-[15px] leading-relaxed ${site.darkMuted}`}>{t("console.pricing.enterpriseBody")}</p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <a href={planHref("enterprise", signedIn)} className={`rounded-md ${site.accent} ${site.accentHover} px-5 py-2.5 text-[14px] font-medium text-white no-underline`}>
              {signedIn ? t("console.pricing.openApp") : t("console.pricing.enterpriseCta")}
            </a>
            {!signedIn && (
              <a href="/signin" className={`text-[14px] ${site.darkMuted} underline underline-offset-4 hover:text-white`}>{t("console.site.signIn")}</a>
            )}
          </div>
        </section>
        {plans !== null && plans.length > 1 && (
          <section aria-labelledby="compare-heading" className="mt-16">
            <h2 id="compare-heading" className="text-[24px] font-semibold tracking-tight sm:text-[28px]">
              {t("console.pricing.compareTitle")}
            </h2>
            <CompareTable plans={plans} />
          </section>
        )}
        <section aria-labelledby="how-heading" className="mt-16 max-w-[720px]">
          <h2 id="how-heading" className="text-[24px] font-semibold tracking-tight sm:text-[28px]">
            {t("console.pricing.howTitle")}
          </h2>
          <ol className="mt-6 space-y-6">
            {[
              { n: "1", title: t("console.pricing.how1t"), body: t("console.pricing.how1b") },
              { n: "2", title: t("console.pricing.how2t"), body: t("console.pricing.how2b") },
              { n: "3", title: t("console.pricing.how3t"), body: t("console.pricing.how3b") },
            ].map((step) => (
              <li key={step.n} className="flex gap-4">
                <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${site.dark} text-[13px] font-semibold ${site.darkInk}`}>
                  {step.n}
                </span>
                <div>
                  <h3 className="text-[16px] font-semibold">{step.title}</h3>
                  <p className={`mt-1 text-[15px] leading-relaxed ${site.muted}`}>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className={`mt-6 text-[14px] leading-relaxed ${site.muted}`}>{t("console.pricing.byoNote")}</p>
        </section>
        <section aria-labelledby="pricing-faq-heading" className="mt-16 max-w-[720px]">
          <h2 id="pricing-faq-heading" className="text-[24px] font-semibold tracking-tight sm:text-[28px]">
            {t("console.site.faqTitle")}
          </h2>
          <div className="mt-4">
            {PRICING_FAQS.map((faq) => (
              <details key={faq.q} className={`group border-t ${site.hairline} py-5 last:border-b`}>
                <summary className="cursor-pointer list-none text-[16px] font-medium [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center justify-between gap-4">
                    {t(faq.q)}
                    <span aria-hidden className={`text-[18px] font-normal ${site.faint} transition-transform group-open:rotate-45`}>+</span>
                  </span>
                </summary>
                <p className={`mt-2 max-w-[640px] text-[15px] leading-relaxed ${site.muted}`}>{t(faq.a)}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <div className={site.dark}>
        <div className="mx-auto w-full max-w-[1120px] px-5 py-14">
          <h2 className={`max-w-[600px] text-[26px] font-semibold tracking-tight ${site.darkInk} sm:text-[32px]`}>
            {t("console.pricing.finalTitle", { app: productName() })}
          </h2>
          <p className={`mt-3 max-w-[540px] text-[15px] leading-relaxed ${site.darkMuted}`}>{t("console.pricing.finalBody")}</p>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <a href={planHref("free", signedIn)} className={`rounded-md ${site.accent} ${site.accentHover} px-6 py-3 text-[15px] font-medium text-white no-underline`}>
              {enter}
            </a>
            <a href="/welcome#tour" className={`text-[15px] ${site.darkMuted} underline underline-offset-4 hover:text-white`}>
              {t("console.site.heroTour")}
            </a>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}

export function PricingPage() {
  const [plans, setPlans] = useState<ConsolePlanView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [person, setPerson] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    consolePlans()
      .then(({ plans: listed }) => {
        if (live) setPlans(listed);
      })
      .catch((thrown: unknown) => {
        if (live) setError(thrown instanceof Error ? thrown.message : t("console.somethingWrong"));
      });
    readSessionState()
      .then((state) => {
        if (!live || !isConnected(state)) return;
        setSignedIn(true);
        if (state.kind === "session") setPerson(state.email?.trim() || state.label.trim() || null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return <PricingView plans={plans} error={error} signedIn={signedIn} person={person} />;
}
