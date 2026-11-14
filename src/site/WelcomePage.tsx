import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";

import { productName } from "../lib/brand";
import { t } from "../lib/i18n";
import { MaximusMark } from "./MaximusMark";
import { SiteShell, site } from "./SiteShell";

const wrap = "mx-auto w-full max-w-[1180px] px-5";
const h2 = "text-[26px] font-semibold tracking-tight sm:text-[32px]";
const lede = `mt-3 max-w-[640px] text-[16px] leading-relaxed ${site.muted}`;
const glass = "rounded-2xl border border-white/10 bg-white/[0.04] shadow-[0_0_0_1px_rgb(255_255_255/0.03)] backdrop-blur-xl";

type MindKind = "think" | "tool" | "say";
type MindStep = { kind: MindKind; text: string };

const DEMO_MIND: MindStep[] = [
  { kind: "think", text: "Reading the request" },
  { kind: "tool", text: "Browsing" },
  { kind: "tool", text: "Drafting the reply" },
  { kind: "say", text: "Two findings are ready. Say the word and I open the change." },
];

function mindForAsk(ask: string): MindStep[] {
  const clipped = ask.trim().slice(0, 80);
  return [
    { kind: "think", text: `Taking “${clipped}”` },
    { kind: "tool", text: "Choosing a bot" },
    { kind: "tool", text: "Checking before anything risky" },
    { kind: "say", text: "That run is sketched. Create your account and I will do it for real." },
  ];
}

function MindStream({ steps }: { steps: MindStep[] }) {
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(steps[0]?.text.length ?? 0);
  const [done, setDone] = useState<MindStep[]>([]);
  useEffect(() => {
    setIndex(0);
    setDone([]);
    setCount(steps[0]?.text.length ?? 0);
  }, [steps]);
  useEffect(() => {
    const text = steps[index]?.text ?? "";
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setCount(text.length);
      const hold = window.setTimeout(() => {
        setDone((prev) => [...prev, steps[index]!].slice(-4));
        setIndex((n) => (n + 1) % steps.length);
      }, 1600);
      return () => window.clearTimeout(hold);
    }
    setCount(0);
    let i = 0;
    let hold = 0;
    const timer = window.setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= text.length) {
        window.clearInterval(timer);
        hold = window.setTimeout(() => {
          setDone((prev) => [...prev, steps[index]!].slice(-4));
          setIndex((n) => (n + 1) % steps.length);
        }, 700);
      }
    }, 16);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(hold);
    };
  }, [index, steps]);
  const current = steps[index];
  const shown = (current?.text ?? "").slice(0, count);
  return (
    <figure className={`m-0 overflow-hidden ${glass}`}>
      <figcaption className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <MaximusMark size={28} live />
        <span className="text-[13px] font-medium">{t("console.site.mindTitle")}</span>
        <span className="ml-auto inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#7FB685]">
          <span className="bull-status" aria-hidden />
          {t("console.site.liveStatus")}
        </span>
      </figcaption>
      <div className="mind-log overflow-hidden px-4 py-3 font-mono text-[13px] leading-6">
        {done.map((step, i) => (
          <p key={`${step.text}-${i}`} className="truncate text-[#A39E93]">
            <MindBadge kind={step.kind} /> {step.text}
          </p>
        ))}
        {current && (
          <p className="truncate text-[#F4F1EA]">
            <MindBadge kind={current.kind} /> {shown}
            <span className="bull-caret" aria-hidden />
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3">
        <span className="bull-dots" aria-hidden><i /><i /><i /></span>
        <span className={`font-mono text-[12px] ${site.muted}`}>{current?.kind === "say" ? t("console.site.mindSay") : t("console.site.mindThink")}</span>
      </div>
    </figure>
  );
}

function MindBadge({ kind }: { kind: MindKind }) {
  const label = kind === "think" ? "think" : kind === "tool" ? "tool" : "say";
  return <span className="text-[#E86A3A]">[{label}]</span>;
}

const BENTO = [
  { title: "console.site.bentoBrowser", body: "console.site.bentoBrowserBody", span: "md:col-span-2 md:row-span-2" },
  { title: "console.site.bentoBots", body: "console.site.bentoBotsBody", span: "md:col-span-2" },
  { title: "console.site.bentoAsk", body: "console.site.bentoAskBody", span: "" },
  { title: "console.site.bentoPlan", body: "console.site.bentoPlanBody", span: "" },
] as const;

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
    <div className={`rounded-2xl border ${site.hairline} bg-white/[0.04] p-6`}>
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
          <div>
            <p className={`text-[14px] ${site.faint}`}>{t("console.site.dlSoon")}</p>
            <a href="/signup" className={`mt-4 inline-flex items-center rounded-md ${site.accent} ${site.accentHover} px-5 py-2.5 text-[14px] font-medium text-white no-underline`}>
              {t("console.site.dlUseWeb")}
            </a>
          </div>
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
  const [draft, setDraft] = useState("");
  const [ask, setAsk] = useState("");
  const [card, setCard] = useState(0);
  const steps = useMemo(() => (ask ? mindForAsk(ask) : DEMO_MIND), [ask]);
  return (
    <SiteShell>
      <main>
        <div className="border-b border-white/10 bg-black/40">
          <div className={`${wrap} flex h-9 items-center gap-6 overflow-hidden font-mono text-[11px] uppercase tracking-[0.16em] text-[#A39E93]`}>
            <span className="inline-flex items-center gap-2 text-[#7FB685]"><span className="bull-status" aria-hidden />{t("console.site.telemetryDemo")}</span>
            <span className="hidden sm:inline">{t("console.site.telemetryRunners")}</span>
            <span className="hidden md:inline">{t("console.site.telemetryAccount")}</span>
          </div>
        </div>

        <section className={`agent-grid ${wrap} pb-12 pt-8 sm:pt-12`}>
          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-10">
            <div className="min-w-0">
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12px] font-medium tracking-wide text-[#E86A3A] backdrop-blur">
                <span className="bull-status" aria-hidden />
                {t("console.site.liveBadge")}
              </p>
              <h1 className="max-w-[14ch] text-[34px] font-semibold leading-[1.08] tracking-tight sm:text-[48px]">
                {t("console.site.heroTitle", { app })}
              </h1>
              <p className={`mt-5 max-w-[42ch] text-[16px] leading-relaxed ${site.muted}`}>{t("console.site.heroBody")}</p>
              <form
                className={`mt-7 flex items-center gap-2 p-2 ${glass}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = draft.trim();
                  if (next) setAsk(next);
                }}
              >
                <label className="sr-only" htmlFor="welcome-ask">{t("console.site.promptPlaceholder")}</label>
                <input
                  id="welcome-ask"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t("console.site.promptPlaceholder")}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[15px] text-[#F4F1EA] outline-none placeholder:text-[#6F685E]"
                />
                <button type="submit" className={`rounded-full ${site.accent} ${site.accentHover} px-4 py-2 text-[14px] font-medium text-white`}>
                  {t("console.site.promptRun")}
                </button>
              </form>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <a href="/signup" className={`rounded-full ${site.accent} ${site.accentHover} px-6 py-3 text-[15px] font-medium text-white no-underline`}>
                  {t("console.site.heroCta")}
                </a>
                <a href="#features" className="rounded-full border border-white/15 px-6 py-3 text-[15px] text-[#F4F1EA] no-underline hover:border-white/40 hover:bg-white/5">
                  {t("console.site.heroTour")}
                </a>
              </div>
              <p className={`mt-4 text-[13px] ${site.faint}`}>{t("console.site.heroNote")}</p>
            </div>
            <MindStream key={ask || "demo"} steps={steps} />
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[13px] text-[#C9C2B2]">
            {MODELS.map((model) => (
              <li key={model} className="rounded-full border border-white/10 bg-black/30 px-3 py-1">{model}</li>
            ))}
          </ul>
        </section>

        <section id="features" className={`${wrap} scroll-mt-20 py-14`}>
          <h2 className={h2}>{t("console.site.featuresTitle")}</h2>
          <p className={lede}>{t("console.site.featuresLede")}</p>
          <div className="mt-8 grid gap-3 md:grid-cols-4">
            {BENTO.map((item, index) => {
              const open = card === index;
              return (
                <button
                  key={item.title}
                  type="button"
                  aria-expanded={open}
                  onClick={() => setCard(index)}
                  className={`${glass} ${item.span} p-5 text-left transition duration-300 hover:border-[#E86A3A]/50 ${open ? "border-[#E86A3A]/60" : ""}`}
                >
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#E86A3A]">0{index + 1}</span>
                  <span className="mt-3 block text-[18px] font-semibold tracking-tight">{t(item.title)}</span>
                </button>
              );
            })}
          </div>
          <div className={`mt-3 h-24 overflow-hidden px-5 py-4 ${glass}`} aria-live="polite">
            <p className="text-[15px] leading-relaxed text-[#C9C2B2]">{t(BENTO[card]!.body)}</p>
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
            <h2 className={`flex max-w-[640px] items-center gap-4 text-[28px] font-semibold tracking-tight ${site.darkInk} sm:text-[36px]`}>
              <MaximusMark size={56} live />
              <span>{t("console.site.finalTitle", { app })}</span>
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
