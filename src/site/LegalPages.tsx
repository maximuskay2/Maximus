import { productName } from "../lib/brand";
import { t } from "../lib/i18n";
import { SiteShell, site } from "./SiteShell";

const wrap = "mx-auto w-full max-w-[720px] px-5 py-14";
const h1 = "text-[34px] font-semibold leading-tight tracking-tight sm:text-[40px]";
const lede = `mt-4 text-[16px] leading-relaxed ${site.muted}`;
const section = "mt-10";
const h2 = "text-[18px] font-semibold tracking-tight";
const body = `mt-3 text-[15px] leading-relaxed ${site.muted}`;

export function AboutPage() {
  const app = productName();
  return (
    <SiteShell>
      <main className={wrap}>
        <h1 className={h1}>{t("console.legal.aboutTitle", { app })}</h1>
        <p className={lede}>{t("console.legal.aboutLede", { app })}</p>
        <section className={section}>
          <h2 className={h2}>{t("console.legal.aboutWhatTitle")}</h2>
          <p className={body}>{t("console.legal.aboutWhatBody", { app })}</p>
        </section>
        <section className={section}>
          <h2 className={h2}>{t("console.legal.aboutContactTitle")}</h2>
          <p className={body}>{t("console.legal.aboutContactBody")}</p>
        </section>
      </main>
    </SiteShell>
  );
}

export function TermsPage() {
  const app = productName();
  return (
    <SiteShell>
      <main className={wrap}>
        <h1 className={h1}>{t("console.legal.termsTitle")}</h1>
        <p className={lede}>{t("console.legal.termsLede", { app })}</p>
        <section className={section}>
          <h2 className={h2}>{t("console.legal.termsAccountTitle")}</h2>
          <p className={body}>{t("console.legal.termsAccountBody")}</p>
        </section>
        <section className={section}>
          <h2 className={h2}>{t("console.legal.termsUseTitle")}</h2>
          <p className={body}>{t("console.legal.termsUseBody", { app })}</p>
        </section>
        <section className={section}>
          <h2 className={h2}>{t("console.legal.termsBillingTitle")}</h2>
          <p className={body}>{t("console.legal.termsBillingBody")}</p>
        </section>
        <section className={section}>
          <h2 className={h2}>{t("console.legal.termsContactTitle")}</h2>
          <p className={body}>{t("console.legal.termsContactBody")}</p>
        </section>
      </main>
    </SiteShell>
  );
}

export function PrivacyPage() {
  const app = productName();
  return (
    <SiteShell>
      <main className={wrap}>
        <h1 className={h1}>{t("console.legal.privacyTitle")}</h1>
        <p className={lede}>{t("console.legal.privacyLede", { app })}</p>
        <section className={section}>
          <h2 className={h2}>{t("console.legal.privacyCollectTitle")}</h2>
          <p className={body}>{t("console.legal.privacyCollectBody")}</p>
        </section>
        <section className={section}>
          <h2 className={h2}>{t("console.legal.privacyUseTitle")}</h2>
          <p className={body}>{t("console.legal.privacyUseBody", { app })}</p>
        </section>
        <section className={section}>
          <h2 className={h2}>{t("console.legal.privacyShareTitle")}</h2>
          <p className={body}>{t("console.legal.privacyShareBody")}</p>
        </section>
        <section className={section}>
          <h2 className={h2}>{t("console.legal.privacyContactTitle")}</h2>
          <p className={body}>{t("console.legal.privacyContactBody")}</p>
        </section>
      </main>
    </SiteShell>
  );
}
