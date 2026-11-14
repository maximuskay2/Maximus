import { useEffect, useState } from "react";

import { watchAccountRation } from "@/lib/account-ration";
import { t } from "@/lib/i18n";
import { formatCost } from "@/lib/usage-trace";
import type { LocaleKey } from "@/locales";
import { api } from "@/state/api";

import { askToSubscribe } from "./SubscribeAsk";

interface RationWallet {
  tier: string;
  leftUsd: number;
  sparkTokens: number;
  contributorOffered: boolean;
  contributorAccepted: boolean;
  storePriceUsd: number;
}

const TIER_KEYS = {
  free: "usage.ration.free",
  byo: "usage.ration.byo",
  starter: "usage.ration.starter",
  plus: "usage.ration.plus",
  pro: "usage.ration.pro",
} as const satisfies Record<string, LocaleKey>;

function useRationWallet(): [RationWallet | null, (next: RationWallet) => void] {
  const [wallet, setWallet] = useState<RationWallet | null>(null);
  useEffect(() => {
    let current = true;
    const load = () => {
      void api<RationWallet>("/api/ration")
        .then((next) => { if (current) setWallet(next); })
        .catch(() => {});
    };
    load();
    const stop = watchAccountRation(load);
    const onShow = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      current = false;
      stop();
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  return [wallet, setWallet];
}

function tierLine(tier: string): string {
  const key = TIER_KEYS[tier as keyof typeof TIER_KEYS];
  return key ? t(key) : tier;
}

export function AccountRation() {
  const [wallet, setWallet] = useRationWallet();
  const accept = () => {
    void api<RationWallet>("/api/ration/contributor", { method: "POST", body: JSON.stringify({ accept: true }) })
      .then(setWallet)
      .catch(() => {});
  };
  return (
    <section className="rounded-2xl border border-hairline/50 bg-card p-5" data-testid="account-ration">
      <h3 className="text-[15px] font-medium text-ink">{t("usage.ration.title")}</h3>
      {wallet ? (
        <>
          <p className="mt-1 text-[13px] text-ink-secondary">{tierLine(wallet.tier)}</p>
          {wallet.tier === "byo" ? (
            <p className="mt-2 text-[14px] text-ink">{t("usage.ration.byoChat")}</p>
          ) : wallet.leftUsd <= 0 ? (
            <p className="mt-2 text-[14px] text-ink">{t("usage.ration.usedUp")}</p>
          ) : (
            <p className="mt-2 text-[14px] text-ink">{t("usage.ration.left", { left: formatCost(wallet.leftUsd), tokens: wallet.sparkTokens.toLocaleString() })}</p>
          )}
          {wallet.storePriceUsd > 0 && <p className="mt-1 text-[13px] text-ink-secondary">{t("usage.ration.store", { price: String(wallet.storePriceUsd) })}</p>}
          {wallet.contributorAccepted && wallet.tier === "free" && <p className="mt-2 text-[13px] text-ink-secondary">{t("usage.ration.contributorOn")}</p>}
          {wallet.contributorOffered && !wallet.contributorAccepted && wallet.tier === "free" && (
            <button type="button" onClick={accept} className="mt-3 rounded-lg border border-hairline/40 px-3 py-1.5 text-[13px] text-ink hover:bg-raised/50">
              {t("usage.ration.accept")}
            </button>
          )}
        </>
      ) : (
        <p className="mt-2 text-[13px] text-ink-secondary">{t("common.checking")}</p>
      )}
      <button type="button" onClick={() => askToSubscribe()} className="mt-3 rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-app">
        {t("subscribe.ask.action")}
      </button>
    </section>
  );
}

export function RationNotice() {
  const [wallet] = useRationWallet();
  if (!wallet) return null;
  if (wallet.tier === "byo") {
    return <p data-testid="ration-notice" className="pointer-events-auto mb-2 text-[12px] text-ink-secondary">{t("usage.ration.byoChat")}</p>;
  }
  if (wallet.leftUsd <= 0) {
    return (
      <div data-testid="ration-notice" className="pointer-events-auto mb-2 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-ink">
        <span className="min-w-0 flex-1">{t("usage.ration.usedUp")}</span>
        <button type="button" onClick={() => askToSubscribe()} className="shrink-0 font-medium">{t("subscribe.ask.action")}</button>
      </div>
    );
  }
  return (
    <p data-testid="ration-notice" className="pointer-events-auto mb-2 text-[12px] text-ink-secondary">
      {`${tierLine(wallet.tier)} · ${t("usage.ration.left", { left: formatCost(wallet.leftUsd), tokens: wallet.sparkTokens.toLocaleString() })}`}
    </p>
  );
}
