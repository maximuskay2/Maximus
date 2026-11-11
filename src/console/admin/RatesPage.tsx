import { useEffect, useState } from "react";

import { t } from "../../lib/i18n";
import {
  adminPayments,
  adminRation,
  HARNESS_SIGN_IN,
  harnessSession,
  HarnessError,
  savePayments,
  saveRation,
  saveRationPoolKey,
  type PaymentSettingsView,
  type RationAdminView,
  type RationProfileView,
} from "../harness";
import { ConsoleError as ErrorBox } from "../shell";
import { EmptyState, LoadingState } from "./ui";

const field = "mt-1 w-full rounded-md border border-hairline/60 bg-app px-3 py-2 text-[14px]";

function moneyInput(value: number, onChange: (next: number) => void) {
  return (
    <input
      className={field}
      inputMode="decimal"
      value={String(value)}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(next);
      }}
    />
  );
}

export function RatesPage() {
  const [sessionReady, setSessionReady] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [view, setView] = useState<RationAdminView | null>(null);
  const [draft, setDraft] = useState<RationProfileView | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    harnessSession().then((session) => {
      if (!live) return;
      setSignedIn(session.kind !== "none");
      setAdmin(session.admin === true);
      if (session.kind === "none" || !session.admin) {
        setSessionReady(true);
        return;
      }
      return adminRation().then((answer) => {
        if (!live) return;
        setView(answer);
        setDraft(answer.profile);
        setSessionReady(true);
      });
    }).catch((thrown: unknown) => {
      if (!live) return;
      setError(thrown instanceof HarnessError ? thrown.message : t("console.somethingWrong"));
      setSessionReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!sessionReady) return <LoadingState />;
  if (!signedIn) {
    return (
      <div>
        <p className="mt-3 text-[14px] text-ink-secondary">{t("console.harness.needsSession")}</p>
        <a href={HARNESS_SIGN_IN} className="mt-5 block w-full rounded-md bg-accent px-4 py-2 text-center text-[14px] font-medium text-accent-ink no-underline">
          {t("console.harness.openSignin")}
        </a>
      </div>
    );
  }
  if (!admin) return <EmptyState title={t("console.harness.adminOnly")} />;
  if (!draft || !view) return <ErrorBox message={error} />;

  const edit = (patch: Partial<RationProfileView>): void => setDraft({ ...draft, ...patch });

  const save = (): void => {
    setBusy(true);
    setError(null);
    setNotice(null);
    saveRation(draft).then((answer) => {
      setView(answer);
      setDraft(answer.profile);
      setNotice(t("console.dashboard.ratesSaved"));
      setBusy(false);
    }, (thrown: unknown) => {
      setError(thrown instanceof HarnessError ? thrown.message : t("console.somethingWrong"));
      setBusy(false);
    });
  };

  const saveKey = (): void => {
    setBusy(true);
    setError(null);
    saveRationPoolKey(key).then((answer) => {
      setView({ ...view, pool: answer.pool });
      setKey("");
      setBusy(false);
    }, (thrown: unknown) => {
      setError(thrown instanceof HarnessError ? thrown.message : t("console.somethingWrong"));
      setBusy(false);
    });
  };

  return (
    <div>
      <p className="text-[13px] text-ink-secondary">{t("console.dashboard.ratesHint")}</p>
      <p className="mt-2 text-[14px]">{t("console.dashboard.ratesPreview", { tokens: view.preview.freeOutputTokens.toLocaleString() })}</p>
      <ErrorBox message={error} />
      {notice ? <p className="mt-3 text-[14px]">{notice}</p> : null}

      <section className="mt-6 rounded-lg border border-hairline/40 p-4">
      <h2 className="text-[15px] font-semibold">{t("console.dashboard.ratesFree")}</h2>
      <label className="mt-4 block text-[13px] font-medium">
        {t("console.dashboard.ratesFree")}
        {moneyInput(draft.freeGrantUsd, (freeGrantUsd) => edit({ freeGrantUsd }))}
      </label>
      <label className="mt-4 flex items-center gap-2 text-[14px]">
        <input type="checkbox" checked={draft.contributorFree} onChange={(event) => edit({ contributorFree: event.target.checked })} />
        {t("console.dashboard.ratesContributor")}
      </label>
      <p className="mt-1 text-[12px] text-ink-secondary">{t("console.dashboard.ratesContributorHint")}</p>
      <label className="mt-4 block max-w-[200px] text-[13px] font-medium">
        {t("console.dashboard.ratesDaily")}
        {moneyInput(draft.freeDailyRequests, (freeDailyRequests) => edit({ freeDailyRequests: Math.max(1, Math.round(freeDailyRequests)) }))}
      </label>

      </section>
      <section className="mt-4 rounded-lg border border-hairline/40 p-4">
      <h2 className="text-[15px] font-semibold">{t("console.dashboard.ratesByo")}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-[13px] font-medium">
          {t("console.dashboard.ratesByo")}
          {moneyInput(draft.byoPriceUsd, (byoPriceUsd) => edit({ byoPriceUsd }))}
        </label>
        <label className="text-[13px] font-medium">
          {t("console.dashboard.ratesByoStore")}
          {moneyInput(draft.byoStorePriceUsd, (byoStorePriceUsd) => edit({ byoStorePriceUsd }))}
        </label>
        <label className="text-[13px] font-medium">
          {t("console.dashboard.ratesByoHour")}
          {moneyInput(draft.byoRequestsPerHour, (byoRequestsPerHour) => edit({ byoRequestsPerHour: Math.max(1, Math.round(byoRequestsPerHour)) }))}
        </label>
        <label className="text-[13px] font-medium">
          {t("console.dashboard.ratesByoDay")}
          {moneyInput(draft.byoRequestsPerDay, (byoRequestsPerDay) => edit({ byoRequestsPerDay: Math.max(1, Math.round(byoRequestsPerDay)) }))}
        </label>
      </div>

      </section>
      <section className="mt-4 rounded-lg border border-hairline/40 p-4">
      <h2 className="text-[15px] font-semibold">{t("console.dashboard.navPlans")}</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="text-ink-secondary">
              <th className="py-1 pr-3 font-medium">Plan</th>
              <th className="py-1 pr-3 font-medium">Price</th>
              <th className="py-1 pr-3 font-medium">Store</th>
              <th className="py-1 pr-3 font-medium">Muse included</th>
              <th className="py-1 font-medium">Hard cap</th>
            </tr>
          </thead>
          <tbody>
            {draft.hosted.map((tier, index) => (
              <tr key={tier.id}>
                <td className="py-1 pr-3 capitalize">{tier.id}</td>
                {(["priceUsd", "storePriceUsd", "includedCostUsd", "hardCapUsd"] as const).map((column) => (
                  <td key={column} className="py-1 pr-3">
                    <input
                      className="w-24 rounded-md border border-hairline/60 bg-app px-2 py-1"
                      inputMode="decimal"
                      value={String(tier[column])}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (!Number.isFinite(next)) return;
                        const hosted = draft.hosted.map((row, rowIndex) => rowIndex === index ? { ...row, [column]: next } : row);
                        edit({ hosted });
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[14px]">{t("console.dashboard.ratesHostedPreview", {
        starter: view.preview.starterOutputTokens.toLocaleString(),
        plus: view.preview.plusOutputTokens.toLocaleString(),
        pro: view.preview.proOutputTokens.toLocaleString(),
      })}</p>

      </section>
      <section className="mt-4 rounded-lg border border-hairline/40 p-4">
      <h2 className="text-[15px] font-semibold">Model rates, $ per 1M tokens</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="text-ink-secondary">
              <th className="py-1 pr-3 font-medium">Model</th>
              <th className="py-1 pr-3 font-medium">Input</th>
              <th className="py-1 pr-3 font-medium">Cached</th>
              <th className="py-1 font-medium">Output</th>
            </tr>
          </thead>
          <tbody>
            {draft.rates.map((rate, index) => (
              <tr key={rate.id}>
                <td className="py-1 pr-3">{rate.id}</td>
                {(["inputPerMillion", "cachedInputPerMillion", "outputPerMillion"] as const).map((column) => (
                  <td key={column} className="py-1 pr-3">
                    <input
                      className="w-24 rounded-md border border-hairline/60 bg-app px-2 py-1"
                      inputMode="decimal"
                      value={String(rate[column])}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (!Number.isFinite(next)) return;
                        const rates = draft.rates.map((row, rowIndex) => rowIndex === index ? { ...row, [column]: next } : row);
                        edit({ rates });
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </section>
      <section className="mt-4 rounded-lg border border-hairline/40 p-4">
      <h2 className="text-[15px] font-semibold">{t("console.dashboard.ratesOverage")}</h2>
      <label className="mt-4 flex items-center gap-2 text-[14px]">
        <input type="checkbox" checked={draft.overageEnabled} onChange={(event) => edit({ overageEnabled: event.target.checked })} />
        {t("console.dashboard.ratesOverage")}
      </label>
      <div className="mt-3 grid max-w-[440px] gap-3 sm:grid-cols-2">
        <label className="text-[13px] font-medium">
          {t("console.dashboard.ratesOverageMult")}
          {moneyInput(draft.overageMultiplier, (overageMultiplier) => edit({ overageMultiplier }))}
        </label>
        <label className="text-[13px] font-medium">
          {t("console.dashboard.ratesOverageCap")}
          {moneyInput(draft.overageCapMultiplier, (overageCapMultiplier) => edit({ overageCapMultiplier: Math.max(1, overageCapMultiplier) }))}
        </label>
      </div>

      <button type="button" className="mt-6 rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50" disabled={busy} onClick={save}>
        {t("console.dashboard.ratesSave")}
      </button>
      </section>

      <section className="mt-4 rounded-lg border border-hairline/40 p-4">
      <h2 className="text-[15px] font-semibold">{t("console.dashboard.ratesPool")}</h2>
      <p className="mt-1 text-[12px] text-ink-secondary">{t("console.dashboard.ratesPoolHint")}</p>
      <p className="mt-2 text-[14px]">{view.pool.configured ? `Key set · ····${view.pool.last4}` : "No key saved"}</p>
      <input className={`${field} max-w-[420px]`} type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} />
      <button type="button" className="mt-3 block rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50" disabled={busy || !key.trim()} onClick={saveKey}>
        {t("console.dashboard.ratesPoolSave")}
      </button>
      </section>
      <PaystackCard />
    </div>
  );
}

function PaystackCard() {
  const [settings, setSettings] = useState<PaymentSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    adminPayments().then((answer) => {
      if (live) setSettings(answer.payments);
    }).catch((thrown: unknown) => {
      if (live) setError(thrown instanceof HarnessError ? thrown.message : t("console.somethingWrong"));
    });
    return () => { live = false; };
  }, []);

  const save = (): void => {
    if (!settings) return;
    setBusy(true);
    setSaved(false);
    setError(null);
    savePayments(settings).then((answer) => {
      setSettings(answer.payments);
      setSaved(true);
      setBusy(false);
    }, (thrown: unknown) => {
      setError(thrown instanceof HarnessError ? thrown.message : t("console.somethingWrong"));
      setBusy(false);
    });
  };

  return (
    <section className="mt-4 rounded-lg border border-hairline/40 p-4">
      <h2 className="text-[15px] font-semibold">Paystack for Nigeria</h2>
      <p className="mt-1 text-[12px] text-ink-secondary">When this is on, people in Nigeria see the Naira price and pay with Paystack. Everyone else keeps the dollar price. The server still needs PAYSTACK_SECRET_KEY. A plan code in MAXIMUS_PAYSTACK_PLANS is optional; without one, Paystack charges this Naira amount.</p>
      {settings ? (
        <>
          <label className="mt-3 flex items-center gap-2 text-[14px]">
            <input
              type="checkbox"
              checked={settings.paystackEnabled}
              onChange={(event) => setSettings({ ...settings, paystackEnabled: event.target.checked })}
            />
            Accept Paystack
          </label>
          <label className="mt-3 block max-w-[240px] text-[13px] font-medium">
            Naira per dollar
            <input
              className={field}
              inputMode="decimal"
              value={String(settings.ngnPerUsd)}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) setSettings({ ...settings, ngnPerUsd: next });
              }}
            />
          </label>
          <p className="mt-1 text-[12px] text-ink-secondary">The rate you charge. 1600 means $19 is ₦30,400.</p>
          <button type="button" className="mt-3 rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50" disabled={busy} onClick={save}>
            Save Paystack
          </button>
        </>
      ) : null}
      <ErrorBox message={error} />
      {saved ? <p className="mt-3 text-[14px]">Paystack settings saved.</p> : null}
    </section>
  );
}
