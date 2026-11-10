import { useEffect, useState } from "react";
import {
  Bot,
  CalendarClock,
  Check,
  Download,
  KeyRound,
  Mic,
  Phone,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";

import { productName } from "../lib/brand";
import { t } from "../lib/i18n";
import { SiteShell, site } from "./SiteShell";

const wrap = "mx-auto w-full max-w-[1120px] px-5";
const h2 = "text-[26px] font-semibold tracking-tight sm:text-[32px]";
const lede = `mt-3 max-w-[640px] text-[16px] leading-relaxed ${site.muted}`;
function Feature({ index, icon, title, children }: { index: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="site-rise rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition duration-300 hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.06]">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-[#E86A3A]">{icon}</span>
        <span aria-hidden className={`font-mono text-[12px] ${site.faint}`}>{index}</span>
      </div>
      <h3 className="mt-4 text-[17px] font-semibold tracking-tight">{title}</h3>
      <div className={`mt-1.5 text-[15px] leading-relaxed ${site.muted}`}>{children}</div>
    </div>
  );
}

/** A hand-built, clearly labeled illustration of the product: no screenshots, no fake data. */
function AppMock() {
  const bubble = "max-w-[85%] rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed";
  return (
    <figure className="site-float mt-10">
      <div className={`overflow-hidden rounded-xl border ${site.darkHairline} bg-[#1D1912] shadow-2xl`}>
        <div className={`flex items-center gap-2 border-b ${site.darkHairline} px-4 py-2.5`}>
          <span aria-hidden className="flex gap-1.5">
            <i className="h-2.5 w-2.5 rounded-full bg-[#3A342A]" />
            <i className="h-2.5 w-2.5 rounded-full bg-[#3A342A]" />
            <i className="h-2.5 w-2.5 rounded-full bg-[#3A342A]" />
          </span>
          <span className={`ml-2 text-[12px] ${site.darkMuted}`}>{t("console.site.mockTitle", { app: productName() })}</span>
        </div>
        <div className="grid md:grid-cols-[220px_1fr]">
          <div className={`hidden border-r ${site.darkHairline} p-3 md:block`}>
            {(["console.site.mockBot1", "console.site.mockBot2", "console.site.mockBot3"] as const).map((key, index) => (
              <div key={key} className={`rounded-lg px-3 py-2.5 ${index === 0 ? "bg-[#2A241B]" : ""}`}>
                <p className={`text-[13px] font-medium ${site.darkInk}`}>{t(key)}</p>
                <p className={`mt-0.5 text-[12px] ${site.darkMuted}`}>{t("console.site.mockBotSub")}</p>
              </div>
            ))}
          </div>
          <div className="space-y-3 p-4 sm:p-5">
            <div className="flex justify-end">
              <p className={`${bubble} bg-[#C2410C] text-white`}>{t("console.site.mockUser")}</p>
            </div>
            <div className={`${bubble} bg-[#2A241B] ${site.darkInk}`}>
              <p>{t("console.site.mockBot")}</p>
            </div>
            <div className={`rounded-lg border ${site.darkHairline} bg-[#221D14] px-3.5 py-2.5 text-[13px]`}>
              <p className={`flex items-center gap-2 font-medium ${site.darkInk}`}>
                <Check size={14} aria-hidden className="text-[#7FB685]" />
                {t("console.site.mockTool")}
              </p>
              <p className={`mt-1 ${site.darkMuted}`}>{t("console.site.mockToolDetail")}</p>
            </div>
            <div className={`flex items-center gap-2 rounded-lg border ${site.darkHairline} bg-[#221D14] px-3.5 py-2.5 text-[13px] ${site.darkMuted}`}>
              <span className="flex-1">{t("console.site.mockComposer")}</span>
              <span aria-hidden className={`rounded-md ${site.accent} px-2.5 py-1 text-[12px] font-medium text-white`}>→</span>
            </div>
          </div>
        </div>
      </div>
      <figcaption className={`mt-3 text-center text-[12px] ${site.faint}`}>{t("console.site.mockCaption")}</figcaption>
    </figure>
  );
}

const FAQS: { q: "console.site.faq1q" | "console.site.faq2q" | "console.site.faq3q" | "console.site.faq4q" | "console.site.faq5q"; a: "console.site.faq1a" | "console.site.faq2a" | "console.site.faq3a" | "console.site.faq4a" | "console.site.faq5a" }[] = [
  { q: "console.site.faq1q", a: "console.site.faq1a" },
  { q: "console.site.faq2q", a: "console.site.faq2a" },
  { q: "console.site.faq3q", a: "console.site.faq3a" },
  { q: "console.site.faq4q", a: "console.site.faq4a" },
  { q: "console.site.faq5q", a: "console.site.faq5a" },
];

const MODELS = ["Claude", "ChatGPT", "Grok", "Kimi", "Muse"];

interface DownloadFile {
  os: "mac" | "windows" | "linux";
  arch: string | null;
  kind: "installer" | "image" | "package";
  file: string;
  bytes: number;
}

function formatMb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}

/** Best guess at the visitor's desktop OS. Phones and tablets get no suggestion — there is no mobile build yet. */
export function detectOs(userAgent: string, platform = ""): "mac" | "windows" | "linux" | null {
  const ua = userAgent.toLowerCase();
  if (ua.includes("android") || ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return null;
  const pf = platform.toLowerCase();
  if (pf.startsWith("mac") || ua.includes("macintosh") || ua.includes("mac os x")) return "mac";
  if (pf.startsWith("win") || ua.includes("windows")) return "windows";
  if (pf.startsWith("linux") || ua.includes("linux") || ua.includes("x11")) return "linux";
  return null;
}

function useDetectedOs(): "mac" | "windows" | "linux" | null {
  const [os] = useState(() => {
    if (typeof navigator === "undefined") return null;
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    return detectOs(navigator.userAgent, nav.userAgentData?.platform ?? navigator.platform ?? "");
  });
  return os;
}

export function DownloadCard({ os, label, note, files, suggested }: { os: DownloadFile["os"]; label: string; note: string; files: DownloadFile[] | null; suggested: boolean }) {
  const primary = files?.find((file) => file.os === os && (os !== "mac" || file.arch !== "x64"))
    ?? files?.find((file) => file.os === os)
    ?? null;
  const secondary = files?.filter((file) => file.os === os && file !== primary) ?? [];
  return (
    <div className={`rounded-2xl border ${site.hairline} bg-white/[0.04] p-6 transition duration-300 hover:-translate-y-1 hover:border-white/25`}>
      {suggested && (
        <p className="mb-3">
          <span className={`inline-block rounded-full ${site.accent} px-3 py-1 text-[12px] font-medium text-white`}>
            {t("console.site.dlSuggested")}
          </span>
        </p>
      )}
      <h3 className="text-[17px] font-semibold tracking-tight">{label}</h3>
      <p className={`mt-1 text-[14px] ${site.muted}`}>{note}</p>
      <div className="mt-5">
        {files === null && (
          <p className={`text-[14px] ${site.faint}`}>{t("console.site.dlChecking")}</p>
        )}
        {files !== null && primary === null && (
          <p className={`text-[14px] ${site.faint}`}>{t("console.site.dlSoon")}</p>
        )}
        {primary !== null && (
          <a
            href={`/api/downloads/file/${encodeURIComponent(primary.file)}`}
            className={suggested
              ? `inline-flex items-center gap-2 rounded-md ${site.accent} ${site.accentHover} px-5 py-2.5 text-[14px] font-medium text-white no-underline`
              : `inline-flex items-center gap-2 rounded-full border ${site.hairline} bg-white/5 px-5 py-2.5 text-[14px] font-medium text-[#F4F1EA] no-underline hover:border-white/30`}
          >
            <Download size={16} aria-hidden />
            {t("console.site.dlDownload")} · {formatMb(primary.bytes)}
          </a>
        )}
        {secondary.length > 0 && (
          <p className={`mt-3 text-[13px] ${site.muted}`}>
            {secondary.map((file) => (
              <a
                key={file.file}
                href={`/api/downloads/file/${encodeURIComponent(file.file)}`}
                className="mr-4 underline underline-offset-4 hover:text-white"
              >
                {file.arch === "x64" && file.os === "mac" ? t("console.site.dlIntel") : t("console.site.dlDeb")}
              </a>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

function DownloadSection() {
  const [files, setFiles] = useState<DownloadFile[] | null>(null);
  const detected = useDetectedOs();
  useEffect(() => {
    let active = true;
    fetch("/api/downloads")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { files?: DownloadFile[] } | null) => {
        if (active) setFiles(Array.isArray(body?.files) ? body.files : []);
      })
      .catch(() => {
        if (active) setFiles([]);
      });
    return () => { active = false; };
  }, []);
  return (
    <section id="download" className={`border-t ${site.hairline} scroll-mt-20`}>
      <div className={`${wrap} py-16`}>
        <h2 className={h2}>{t("console.site.dlTitle", { app: productName() })}</h2>
        <p className={lede}>{t("console.site.dlBody")}</p>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          <DownloadCard os="mac" label={t("console.site.dlMac")} note={t("console.site.dlMacNote")} files={files} suggested={detected === "mac"} />
          <DownloadCard os="windows" label={t("console.site.dlWin")} note={t("console.site.dlWinNote")} files={files} suggested={detected === "windows"} />
          <DownloadCard os="linux" label={t("console.site.dlLinux")} note={t("console.site.dlLinuxNote")} files={files} suggested={detected === "linux"} />
        </div>
      </div>
    </section>
  );
}

export function WelcomeView() {
  const app = productName();
  return (
    <SiteShell>
      <main>
        <section className={`${wrap} site-rise pb-16 pt-16 sm:pt-24`}>
          <h1 className="max-w-[820px] text-[42px] font-semibold leading-[1.02] tracking-tight sm:text-[68px]">
            {t("console.site.heroTitle", { app })}
          </h1>
          <p className={`mt-6 max-w-[620px] text-[18px] leading-relaxed ${site.muted}`}>{t("console.site.heroBody")}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="/signup" className={`rounded-full ${site.accent} ${site.accentHover} px-6 py-3 text-[15px] font-medium text-white no-underline`}>
              {t("console.site.heroCta")}
            </a>
            <a href="#tour" className="rounded-full border border-white/15 px-6 py-3 text-[15px] text-[#F4F1EA] no-underline transition hover:border-white/40 hover:bg-white/5">
              {t("console.site.heroTour")}
            </a>
          </div>
          <p className={`mt-4 text-[13px] ${site.faint}`}>{t("console.site.heroNote")}</p>
        </section>

        <section className={site.dark}>
          <div className={`${wrap} py-14`}>
            <AppMock />
            <div className={`mt-10 border-t ${site.darkHairline} pt-8`}>
              <p className={`text-[13px] font-medium uppercase tracking-wider ${site.darkMuted}`}>{t("console.site.modelsTitle")}</p>
              <div className="mt-4 overflow-hidden">
                <ul className={`site-marquee flex w-max gap-12 text-[18px] font-semibold ${site.darkInk}`}>
                  {[...MODELS, ...MODELS].map((model, index) => (
                    <li key={`${model}-${index}`}>{model}</li>
                  ))}
                </ul>
              </div>
              <p className={`mt-3 max-w-[600px] text-[14px] leading-relaxed ${site.darkMuted}`}>{t("console.site.modelsBody")}</p>
            </div>
          </div>
        </section>

        <section id="features" className={`${wrap} scroll-mt-20 py-16`}>
          <h2 className={h2}>{t("console.site.featuresTitle")}</h2>
          <p className={lede}>{t("console.site.featuresLede")}</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <Feature index="01" icon={<Bot size={18} />} title={t("console.site.fAgentsTitle")}>
              <p>{t("console.site.fAgentsBody")}</p>
            </Feature>
            <Feature index="02" icon={<KeyRound size={18} />} title={t("console.site.fModelsTitle")}>
              <p>{t("console.site.fModelsBody")}</p>
            </Feature>
            <Feature index="03" icon={<Users size={18} />} title={t("console.site.fTeamsTitle")}>
              <p>{t("console.site.fTeamsBody")}</p>
            </Feature>
            <Feature index="04" icon={<CalendarClock size={18} />} title={t("console.site.fAutoTitle")}>
              <p>{t("console.site.fAutoBody")}</p>
            </Feature>
            <Feature index="05" icon={<Workflow size={18} />} title={t("console.site.fToolsTitle")}>
              <p>{t("console.site.fToolsBody")}</p>
            </Feature>
            <Feature index="06" icon={<Mic size={18} />} title={t("console.site.fVoiceTitle")}>
              <p>{t("console.site.fVoiceBody")}</p>
            </Feature>
            <Feature index="07" icon={<Phone size={18} />} title={t("console.site.fDevicesTitle")}>
              <p>{t("console.site.fDevicesBody")}</p>
            </Feature>
            <Feature index="08" icon={<ShieldCheck size={18} />} title={t("console.site.fAdminTitle")}>
              <p>{t("console.site.fAdminBody")}</p>
            </Feature>
          </div>
        </section>

        <section id="tour" className={`border-t ${site.hairline} scroll-mt-20`}>
          <div className={`${wrap} py-16`}>
            <h2 className={h2}>{t("console.site.tourTitle")}</h2>
            <p className={lede}>{t("console.site.tourBody")}</p>
            <div className="mt-10 grid gap-x-10 gap-y-10 sm:grid-cols-2">
              {[
                { title: t("console.site.tourApp"), items: [
                  { label: t("console.site.tourChats"), href: "/app", note: t("console.site.tourChatsNote") },
                  { label: t("console.site.tourSettings"), href: "/app", note: t("console.site.tourSettingsNote") },
                ] },
                { title: t("console.site.tourAccount"), items: [
                  { label: t("console.site.tourSignup"), href: "/signup", note: t("console.site.tourSignupNote") },
                  { label: t("console.site.tourSignin"), href: "/signin", note: t("console.site.tourSigninNote") },
                  { label: t("console.site.tourPricing"), href: "/pricing", note: t("console.site.tourPricingNote") },
                ] },
                { title: t("console.site.tourStart"), items: [
                  { label: t("console.site.step1Title"), href: "/signup", note: t("console.site.step1Body") },
                  { label: t("console.site.step2Title"), href: "/app", note: t("console.site.step2Body") },
                  { label: t("console.site.step3Title"), href: "/app", note: t("console.site.step3Body") },
                ] },
              ].map((group) => (
                <div key={group.title}>
                  <h3 className={`text-[13px] font-semibold uppercase tracking-wider ${site.faint}`}>{group.title}</h3>
                  <ul className="mt-3 space-y-2.5">
                    {group.items.map((item) => (
                      <li key={item.href + item.label} className="text-[15px]">
                        <a href={item.href} className="font-medium text-[#F4F1EA] underline decoration-white/20 underline-offset-4 hover:decoration-white">
                          {item.label}
                        </a>
                        <span className={site.muted}> — {item.note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className={`border-t ${site.hairline} scroll-mt-20`}>
          <div className={`${wrap} py-16`}>
            <h2 className={h2}>{t("console.site.faqTitle")}</h2>
            <div className="mt-6 max-w-[720px]">
              {FAQS.map((faq) => (
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
          </div>
        </section>

        <DownloadSection />

        <section className={site.dark}>
          <div className={`${wrap} py-16`}>
            <h2 className={`max-w-[640px] text-[28px] font-semibold tracking-tight ${site.darkInk} sm:text-[36px]`}>
              {t("console.site.finalTitle", { app })}
            </h2>
            <p className={`mt-3 max-w-[560px] text-[16px] leading-relaxed ${site.darkMuted}`}>{t("console.site.finalBody")}</p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a href="/signup" className={`rounded-full ${site.accent} ${site.accentHover} px-6 py-3 text-[15px] font-medium text-white no-underline`}>
                {t("console.site.heroCta")}
              </a>
              <a href="/pricing" className={`text-[15px] ${site.darkMuted} underline underline-offset-4 hover:text-white`}>
                {t("console.site.plansCta")}
              </a>
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}

export function WelcomePage() {
  return <WelcomeView />;
}
