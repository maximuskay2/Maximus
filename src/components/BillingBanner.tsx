import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";

export interface BillingBannerData {
  kind: "grace" | "suspended";
  title: string;
  body: string;
}

interface BillingStatusResponse {
  billing?: {
    banner?: BillingBannerData | null;
  };
}

export function bannerTone(banner: BillingBannerData | null): "warning" | "danger" | null {
  if (!banner) return null;
  return banner.kind === "suspended" ? "danger" : "warning";
}

export function BillingBannerView({ banner }: { banner: BillingBannerData | null }) {
  const tone = bannerTone(banner);
  if (!banner || !tone) return null;
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[13px] leading-relaxed",
        tone === "danger" ? "border-danger/40 bg-danger/10 text-danger" : "border-warning/40 bg-warning/10 text-warning",
      )}
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>
        <strong className="font-semibold">{banner.title}</strong> — {banner.body}
      </span>
    </div>
  );
}

export function BillingBanner() {
  const [banner, setBanner] = useState<BillingBannerData | null>(null);
  useEffect(() => {
    let live = true;
    api<BillingStatusResponse>("/api/billing/status")
      .then((status) => {
        if (live) setBanner(status.billing?.banner ?? null);
      })
      .catch(() => {
        if (live) setBanner(null);
      });
    return () => {
      live = false;
    };
  }, []);
  return <BillingBannerView banner={banner} />;
}
