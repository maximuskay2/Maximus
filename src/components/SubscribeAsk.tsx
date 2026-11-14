import { useEffect, useState } from "react";

import { billingOffer, consolePlans, formatUsd, planPriceLine, startBachsCheckout, startPaystackCheckout, startStripeCheckout, type BillingOfferView, type ConsolePlanView } from "@/console/account";
import { openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import { accountChoiceFromPlan, takePendingPlan } from "@/lib/pending-plan";
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

async function accountChoice(): Promise<"free" | "byo" | "muse" | null> {
  const body = await api<{ choice?: unknown }>("/api/account/plan");
  const choice = body.choice;
  return choice === "free" || choice === "byo" || choice === "muse" ? choice : null;
}

function saveChoice(choice: "free" | "byo" | "muse"): Promise<unknown> {
  return api("/api/account/plan", { method: "POST", body: JSON.stringify({ choice }) });
}

function allowanceLine(plan: ConsolePlanView): string {
  if (plan.id === "free" && plan.allowanceUsd > 0) return t("console.pricing.freeGrant", { amount: formatUsd(plan.allowanceUsd) });
  if (plan.allowanceUsd > 0) return t("console.pricing.allowance", { amount: formatUsd(plan.allowanceUsd) });
  return plan.blurb;
}

function nairaLine(usd: number, ngnPerUsd: number): string {
  return `₦${Math.round(usd * ngnPerUsd).toLocaleString("en-NG")}/mo`;
}

function payLabel(provider: BillingOfferView["provider"] | undefined, busy: boolean): string {
  if (busy) return "Opening…";
  if (provider === "paystack") return "Pay with Paystack";
  if (provider === "bachs") return "Pay with Bachs";
  return "Subscribe";
}

async function openCheckout(url: string): Promise<void> {
  if (window.ogb?.openExternal) {
    await openExternalLink(url);
    return;
  }
  window.location.assign(url);
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
    const fromUrl = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("plan") : null;
    const pending = takePendingPlan() ?? (fromUrl && /^[a-z][a-z0-9-]{1,30}$/.test(fromUrl) ? fromUrl : null);
    void readSessionState().then(async (state) => {
      // The machine window can be signed in without an account. The plan list waits for the email sign-in.
      if (!live || state.kind !== "session" || !state.email) return;
      if (pending) {
        const choice = accountChoiceFromPlan(pending);
        await saveChoice(choice).catch(() => undefined);
        if (!live) return;
        if (pending === "free") {
          remember();
          return;
        }
        setPlansOpen(true);
        return;
      }
      if (alreadyChosen()) return;
      const choice = await accountChoice().catch(() => null);
      if (!live) return;
      if (choice) {
        remember();
        return;
      }
      setPlansOpen(true);
    }).catch(() => undefined);
    return () => { live = false; listeners.delete(openAsk); };
  }, []);

  useEffect(() => {
    if (!plansOpen || plans) return;
    let live = true;
    consolePlans().then((answer) => {
      if (live) setPlans(answer.plans);
    }).catch(() => {
      if (live) setPlans([]);
    });
    return () => { live = false; };
  }, [plansOpen, plans]);

  useEffect(() => {
    if (!plansOpen || offer) return;
    let live = true;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    billingOffer(zone).then((answer) => {
      if (live) setOffer(answer.offer);
    }).catch((thrown: unknown) => {
      if (!live) return;
      setPayError(thrown instanceof Error ? thrown.message : "The payment page could not be opened.");
    });
    return () => { live = false; };
  }, [plansOpen, offer]);

  const takeFree = (): void => {
    if (freeUsedUp) {
      remember();
      setPlansOpen(false);
      return;
    }
    setPaying("free");
    setPayError(null);
    void saveChoice("free").then(() => api<{ tier: string; grantedUsd: number; leftUsd: number }>("/api/ration")).then((wallet) => {
      if (wallet.tier !== "free") {
        const paid = wallet.tier === "byo" ? "byo" : "muse";
        return saveChoice(paid).then(() => {
          remember();
          setPlansOpen(false);
        });
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

  const pay = (plan: ConsolePlanView, provider: BillingOfferView["provider"]): void => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setPaying(plan.id);
    setPayError(null);
    void readSessionState().then(async (state) => {
      const email = state.kind === "session" ? state.email : undefined;
      if (!email) {
        setPayError(provider === "bachs" ? "Sign in with email to pay with Bachs." : provider === "paystack" ? "Sign in with email to pay with Paystack." : "Sign in with email to subscribe.");
        setPaying(null);
        return;
      }
      const origin = window.location.origin;
      const choice = plan.id === "byo" ? "byo" : "muse";
      await saveChoice(choice);
      const input = {
        plan: plan.id,
        customerEmail: email,
        successUrl: `${origin}/app`,
        cancelUrl: `${origin}/app`,
        timeZone: zone,
      };
      const answer = provider === "bachs"
        ? await startBachsCheckout(input)
        : provider === "paystack"
          ? await startPaystackCheckout(input)
          : await startStripeCheckout(input);
      await openCheckout(answer.checkout.url);
      if (window.ogb?.openExternal) setPaying(null);
    }).catch((thrown: unknown) => {
      setPayError(thrown instanceof Error ? thrown.message : "Checkout could not start.");
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
            {plans === null ? <p className="text-[14px] text-ink-secondary">{t("console.loading")}</p> : plans.map((plan) => {
              const paid = plan.baseUsd > 0;
              const provider = offer?.provider;
              return (
              <article key={plan.id} className="rounded-xl border border-hairline/50 px-4 py-3">
                {paid ? (
                  <button type="button" className="block w-full text-left disabled:opacity-60" disabled={!provider || paying === plan.id} onClick={() => provider && pay(plan, provider)}>
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-[15px] font-semibold text-ink">{plan.name}</span>
                      <span className="text-[15px] font-semibold text-accent">{priceOf(plan)}</span>
                    </span>
                    <span className="mt-1 block text-[13px] text-ink-secondary">{allowanceLine(plan)}</span>
                    <span className="ui-button ui-button-primary mt-3">{payLabel(provider, paying === plan.id)}</span>
                  </button>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-[15px] font-semibold">{plan.name}</h3>
                      <p className="text-[15px] font-semibold text-accent">{priceOf(plan)}</p>
                    </div>
                    <p className="mt-1 text-[13px] text-ink-secondary">{allowanceLine(plan)}</p>
                    <button type="button" className="ui-button ui-button-primary mt-3" disabled={paying === "free"} onClick={takeFree}>
                      {paying === "free" ? "Opening…" : freeUsedUp ? "Continue" : "Use free"}
                    </button>
                  </>
                )}
              </article>
              );
            })}
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
