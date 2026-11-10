import { useEffect, useState } from "react";
import {
  Building2,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Settings,
  Tag,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import { productName } from "../../lib/brand";
import { t } from "../../lib/i18n";
import type { LocaleKey } from "../../locales";

export type DashboardView = "overview" | "users" | "workspace" | "plans" | "rates" | "keys" | "messages" | "settings";

export const DASHBOARD_VIEWS: ReadonlyArray<{ id: DashboardView; labelKey: "console.dashboard.navOverview" | "console.dashboard.navUsers" | "console.admin.legWorkspace" | "console.dashboard.navPlans" | "console.dashboard.navRates" | "console.harness.keys" | "console.harness.messages" | "console.dashboard.navSettings"; icon: LucideIcon }> = [
  { id: "overview", labelKey: "console.dashboard.navOverview", icon: LayoutDashboard },
  { id: "users", labelKey: "console.dashboard.navUsers", icon: Users },
  { id: "workspace", labelKey: "console.admin.legWorkspace", icon: Building2 },
  { id: "plans", labelKey: "console.dashboard.navPlans", icon: Tag },
  { id: "rates", labelKey: "console.dashboard.navRates", icon: Tag },
  { id: "keys", labelKey: "console.harness.keys", icon: KeyRound },
  { id: "messages", labelKey: "console.harness.messages", icon: MessagesSquare },
  { id: "settings", labelKey: "console.dashboard.navSettings", icon: Settings },
];

export function dashboardViewFromParam(raw: string | null): DashboardView {
  return DASHBOARD_VIEWS.some((view) => view.id === raw) ? (raw as DashboardView) : "overview";
}

const NAV_GROUPS: ReadonlyArray<{ labelKey: LocaleKey | null; ids: readonly DashboardView[] }> = [
  { labelKey: null, ids: ["overview"] },
  { labelKey: "console.harness.users", ids: ["users", "workspace"] },
  { labelKey: "console.dashboard.navPlans", ids: ["plans", "rates"] },
  { labelKey: "console.harness.server", ids: ["keys", "messages", "settings"] },
];

const PAGE_LEAD: Record<DashboardView, LocaleKey> = {
  overview: "console.harness.subtitle",
  users: "console.harness.subtitle",
  workspace: "console.admin.seats",
  plans: "console.dashboard.plansHint",
  rates: "console.dashboard.ratesHint",
  keys: "console.harness.subtitle",
  messages: "console.harness.subtitle",
  settings: "console.harness.subtitle",
};

function SidebarBody({ view, onView, onLogout, onNavigate }: {
  view: DashboardView;
  onView: (next: DashboardView) => void;
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  const link = (active: boolean): string =>
    `flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[14px] ${active ? "bg-control font-medium text-ink" : "text-ink-secondary hover:bg-control/60 hover:text-ink"}`;
  return (
    <div className="flex h-full flex-col">
      <p className="px-3 pb-1 pt-1 text-[15px] font-semibold">{t("console.admin.title")}</p>
      <p className="px-3 text-[12px] text-ink-faint">{productName()}</p>
      <nav aria-label={t("console.admin.legs")} className="mt-4 flex flex-col gap-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.labelKey ?? "home"}>
            {group.labelKey ? <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">{t(group.labelKey)}</p> : null}
            <div className="flex flex-col gap-0.5">
              {group.ids.map((id) => {
                const entry = DASHBOARD_VIEWS.find((row) => row.id === id);
                if (!entry) return null;
                const Icon = entry.icon;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={link(view === entry.id)}
                    aria-current={view === entry.id ? "page" : undefined}
                    onClick={() => {
                      onView(entry.id);
                      onNavigate?.();
                    }}
                  >
                    <Icon size={16} aria-hidden />
                    {t(entry.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="flex-1" />
      <button type="button" className={`${link(false)} mt-4`} onClick={onLogout}>
        <LogOut size={16} aria-hidden />
        {t("console.admin.signOut")}
      </button>
      <a href="/app" className="mt-1 px-3 py-2 text-[13px] text-ink-secondary underline">{t("console.admin.viewApp")}</a>
    </div>
  );
}

export function DashboardShell({ view, onView, identity, onLogout, children }: {
  view: DashboardView;
  onView: (next: DashboardView) => void;
  identity: string;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);
  const entry = DASHBOARD_VIEWS.find((row) => row.id === view);
  return (
    <div className="min-h-screen bg-app text-ink">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-hairline/40 bg-app px-4">
        <button
          type="button"
          className="rounded-md p-2 text-ink-secondary hover:bg-control lg:hidden"
          aria-label={t("console.dashboard.openNav")}
          onClick={() => setDrawer(true)}
        >
          <Menu size={18} />
        </button>
        <button
          type="button"
          className="hidden rounded-md p-2 text-ink-secondary hover:bg-control lg:block"
          aria-label={t("console.dashboard.toggleNav")}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <Menu size={18} /> : <X size={18} />}
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold">{entry ? t(entry.labelKey) : ""}</h1>
          <p className="hidden truncate text-[12px] text-ink-faint sm:block">{t(PAGE_LEAD[view])}</p>
        </div>
        <span className="flex-1" />
        {identity ? <span className="hidden max-w-[220px] truncate rounded-full border border-hairline/50 px-2.5 py-1 text-[12px] text-ink-secondary sm:block">{identity}</span> : null}
      </header>
      <div className="mx-auto flex w-full max-w-[1280px]">
        <aside className={`sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 overflow-y-auto border-r border-hairline/40 px-3 py-4 lg:block ${collapsed ? "lg:hidden" : "w-[240px]"}`}>
          <SidebarBody view={view} onView={onView} onLogout={onLogout} />
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("console.admin.legs")}>
            <button type="button" aria-label={t("console.dashboard.close")} className="absolute inset-0 cursor-default bg-black/40" onClick={() => setDrawer(false)} />
            <div className="absolute inset-y-0 left-0 w-[280px] overflow-y-auto bg-app px-3 py-4 shadow-xl">
              <SidebarBody view={view} onView={onView} onLogout={onLogout} onNavigate={() => setDrawer(false)} />
            </div>
          </div>
        )}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
