import { useEffect, useState } from "react";

import { billingOffer, consolePlans, formatUsd, planPriceLine, startPaystackCheckout, type BillingOfferView, type ConsolePlanView } from "@/console/account";
import { t } from "@/lib/i18n";
import { readSessionState } from "@/lib/session";
import { api } from "@/state/api";

const CHOSEN = "maximus.plan.chosen";

const listeners = new Set<() => void>();

/** Opens the plan list from the account menu. */
export function askToSubscribe(): void {
  for (const listener of listeners) listener();
}

function remember(): void {
  try { localStorage.setItem(CHOSEN, "1"); } catch { /* a private window still has to choose this visit */ }
}

function alreadyChosen(): boolean {
  try { return localStorage.getItem(CHOSEN) === "1"; } catch { return false; }
}

function allowanceLine(plan: ConsolePlanView): string {
  if (plan.id === "free" && plan.allowanceUsd > 0) return t("console.pricing.freeGrant", { amount: formatUsd(plan.allowanceUsd) });
  if (plan.allowanceUsd > 0) return t("console.pricing.allowance", { amount: formatUsd(plan.allowanceUsd) });
  return plan.blurb;
}

function nairaLine(usd: number, ngnPerUsd: number): string {
  return `₦${Math.round(usd * ngnPerUsd).toLocaleString("en-NG")}/mo`;
}

export function SubscribeAsk() {
  const [plansOpen, setPlansOpen] = useState(false);
  const [plans, setPlans] = useState<ConsolePlanView[] | null>(null);
  const [offer, setOffer] = useState<BillingOfferView | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [freeUsedUp, setFreeUsedUp] = useState(false);

  useEffect(() => {
    const openAsk = () => setPlansOpen(true);
    listeners.add(openAsk);
    let live = true;
    if (!alreadyChosen()) {
      void readSessionState().then((state) => {
        // The machine window can be signed in without an account. The plan list waits for the email sign-in.
        if (live && state.kind === "session" && state.email) setPlansOpen(true);
      }).catch(() => undefined);
    }
    return () => { live = false; listeners.delete(openAsk); };
  }, []);

  useEffect(() => {
    if (!plansOpen || plans) return;
    let live = true;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    consolePlans().then((answer) => {
      if (live) setPlans(answer.plans);
    }).catch(() => {
      if (live) setPlans([]);
    });
    billingOffer(zone).then((answer) => {
      if (live) setOffer(answer.offer);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [plansOpen, plans]);

  const takeFree = (): void => {
    if (freeUsedUp) {
      remember();
      setPlansOpen(false);
      return;
    }
    setPaying("free");
    setPayError(null);
    void api<{ tier: string; grantedUsd: number; leftUsd: number }>("/api/ration").then((wallet) => {
      if (wallet.tier !== "free") {
        remember();
        setPlansOpen(false);
        return;
      }
      if (wallet.leftUsd <= 0) {
        setFreeUsedUp(true);
        setPayError(wallet.grantedUsd <= 0
          ? "This email already used its free Muse grant."
          : "This free Muse grant is used up.");
        setPaying(null);
        return;
      }
      remember();
      setPlansOpen(false);
    }).catch((thrown: unknown) => {
      setPayError(thrown instanceof Error ? thrown.message : "The free plan could not be opened.");
      setPaying(null);
    });
  };

  const pay = (plan: ConsolePlanView): void => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setPaying(plan.id);
    setPayError(null);
    void readSessionState().then(async (state) => {
      const email = state.kind === "session" ? state.email : undefined;
      if (!email) {
        setPayError("Sign in with email to pay with Paystack.");
        setPaying(null);
        return;
      }
      const origin = window.location.origin;
      const answer = await startPaystackCheckout({
        plan: plan.id,
        customerEmail: email,
        successUrl: `${origin}/app`,
        cancelUrl: `${origin}/app`,
        timeZone: zone,
      });
      window.location.assign(answer.checkout.url);
    }).catch((thrown: unknown) => {
      setPayError(thrown instanceof Error ? thrown.message : "Paystack could not start.");
      setPaying(null);
    });
  };

  const priceOf = (plan: ConsolePlanView): string => {
    if (plan.id === "free" || plan.baseUsd <= 0) return t("console.free");
    if (offer?.currency === "NGN") return nairaLine(plan.baseUsd, offer.ngnPerUsd);
    return planPriceLine(plan);
  };

  if (!plansOpen) return null;
  return (
      <div className="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-6">
        <div role="dialog" aria-modal="true" aria-labelledby="subscribe-plans-title" className="max-h-[80vh] w-full max-w-[480px] overflow-y-auto rounded-2xl bg-app p-6">
          <h2 id="subscribe-plans-title" className="text-[18px] font-semibold text-ink">{t("console.pricing.title")}</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-secondary">{t("console.pricing.subtitle")}</p>
          <div className="mt-4 flex flex-col gap-3">
            {plans === null ? <p className="text-[14px] text-ink-secondary">{t("console.loading")}</p> : plans.map((plan) => (
              <article key={plan.id} className="rounded-xl border border-hairline/50 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[15px] font-semibold">{plan.name}</h3>
                  <p className="text-[15px] font-semibold text-accent">{priceOf(plan)}</p>
                </div>
                <p className="mt-1 text-[13px] text-ink-secondary">{allowanceLine(plan)}</p>
                {plan.baseUsd <= 0 ? (
                  <button type="button" className="ui-button ui-button-primary mt-3" disabled={paying === "free"} onClick={takeFree}>
                    {paying === "free" ? "Opening…" : freeUsedUp ? "Continue" : "Use free"}
                  </button>
                ) : offer?.provider === "paystack" ? (
                  <button type="button" className="ui-button ui-button-primary mt-3" disabled={paying === plan.id} onClick={() => pay(plan)}>
                    Pay with Paystack
                  </button>
                ) : null}
              </article>
            ))}
          </div>
          {payError ? <p className="mt-3 text-[13px] text-danger">{payError}</p> : null}
          {alreadyChosen() ? (
            <div className="mt-5 flex justify-end">
              <button type="button" className="ui-button" onClick={() => setPlansOpen(false)}>Close</button>
            </div>
          ) : null}
        </div>
      </div>
  );
}
