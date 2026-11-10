import { useEffect, useState } from "react";

import { t } from "../../lib/i18n";
import { formatWhen } from "../AdminPage";
import {
  consoleAccount,
  myMemberships,
  rememberedWorkspace,
  workspaceSeats,
  type ConsoleAccount,
} from "../account";
import {
  harnessActivity,
  harnessBots,
  harnessConfig,
  harnessEdition,
  harnessHealth,
  HARNESS_SIGN_IN,
  harnessSession,
  harnessSessions,
  harnessUsage,
  toSignInLists,
  type HarnessActivityView,
  type HarnessSessionView,
  type UsageGroupView,
} from "../harness";
import { toSeatViews } from "../../components/WorkspaceAccountSection";
import { EmptyState, LoadingState, MetricCard, Sparkline, sparkTrend } from "./ui";
import { ConsoleError as ErrorBox } from "../shell";

export interface OverviewMetrics {
  totalUsers: number;
  activeSessions: number;
  bots: number;
  workspaces: number;
  monthTokens: string;
  monthCost: string | null;
}

export interface OverviewModel {
  metrics: OverviewMetrics;
  trend: (number | null)[];
  trendLabel: string;
  activity: HarnessActivityView[];
  edition: string;
  healthy: boolean;
}

export function OverviewView({ model, loading, error }: { model: OverviewModel | null; loading: boolean; error: string | null }) {
  if (loading && !model) return <LoadingState />;
  if (!model) return <EmptyState title={t("console.dashboard.noAccess")} body={error ?? undefined} />;
  const trend = sparkTrend(model.trend);
  const duties: Array<{ view: string; label: "console.dashboard.navUsers" | "console.dashboard.navPlans" | "console.dashboard.navRates" | "console.harness.keys" | "console.harness.messages" | "console.dashboard.navSettings" }> = [
    { view: "users", label: "console.dashboard.navUsers" },
    { view: "plans", label: "console.dashboard.navPlans" },
    { view: "rates", label: "console.dashboard.navRates" },
    { view: "keys", label: "console.harness.keys" },
    { view: "messages", label: "console.harness.messages" },
    { view: "settings", label: "console.dashboard.navSettings" },
  ];
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="rounded-full border border-hairline/50 px-2.5 py-1">{t("console.harness.health")}: {model.healthy ? t("console.harness.healthy") : t("console.harness.unhealthy")}</span>
        <span className="rounded-full border border-hairline/50 px-2.5 py-1">{t("console.harness.edition")}: {model.edition}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t("console.dashboard.totalUsers")} value={String(model.metrics.totalUsers)} hint={model.edition} />
        <MetricCard label={t("console.dashboard.activeSessions")} value={String(model.metrics.activeSessions)} />
        <MetricCard label={t("console.dashboard.bots")} value={String(model.metrics.bots)} />
        <MetricCard label={t("console.dashboard.workspaces")} value={String(model.metrics.workspaces)} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <MetricCard label={t("console.dashboard.monthUsage")} value={model.metrics.monthTokens} hint={model.metrics.monthCost ?? undefined} trend={trend} />
        <div className="rounded-md border border-hairline/40 px-4 py-3">
          <p className="text-[12px] font-medium text-ink-secondary">{t("console.dashboard.usageTrend")}</p>
          <div className="mt-2"><Sparkline values={model.trend} label={model.trendLabel} /></div>
          <p className="mt-1 text-[12px] text-ink-secondary">{model.trendLabel}</p>
        </div>
      </div>
      <h2 className="mt-8 text-[15px] font-semibold">{t("console.admin.legs")}</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {duties.map((duty) => (
          <a key={duty.view} href={`/admin?view=${duty.view}`} className="rounded-md border border-hairline/40 px-4 py-3 text-[14px] font-medium no-underline hover:bg-control/60">
            {t(duty.label)}
          </a>
        ))}
      </div>
      <h2 id="overview-activity" className="mt-8 text-[15px] font-semibold">{t("console.dashboard.recentActivity")}</h2>
      {model.activity.length === 0 ? (
        <EmptyState title={t("console.admin.noAudit")} />
      ) : (
        <table aria-labelledby="overview-activity" className="mt-3 w-full text-[14px]">
          <thead>
            <tr className="border-b border-hairline/40 text-left text-[13px] text-ink-secondary">
              <th className="py-1.5 pr-3 font-medium">{t("console.dashboard.colAction")}</th>
              <th className="py-1.5 pr-3 font-medium">{t("console.dashboard.colDetail")}</th>
              <th className="py-1.5 font-medium">{t("console.dashboard.colWhen")}</th>
            </tr>
          </thead>
          <tbody>
            {model.activity.slice(0, 10).map((entry) => (
              <tr key={entry.id} className="border-t border-hairline/40">
                <td className="py-1.5 pr-3 font-mono text-[13px]">{entry.action}</td>
                <td className="py-1.5 pr-3 text-ink-secondary">{entry.summary || "—"}</td>
                <td className="py-1.5 text-[13px] text-ink-secondary">{formatWhen(entry.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ErrorBox message={error} />
    </div>
  );
}

function uniqueEmails(values: (string | null | undefined)[]): number {
  return new Set(values.map((value) => value?.trim().toLowerCase()).filter((value): value is string => Boolean(value))).size;
}

export function OverviewPage() {
  const [model, setModel] = useState<OverviewModel | null>(null);
  const [session, setSession] = useState<HarnessSessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const account: ConsoleAccount | null = consoleAccount.load();
    Promise.all([
      harnessSession(),
      harnessHealth().catch(() => ({ ok: false, version: "" })),
      harnessEdition().catch(() => ({ edition: "unknown", detail: "" })),
      harnessConfig().catch(() => null),
      harnessSessions().then((answer) => answer.sessions, () => []),
      harnessBots().then((answer) => answer.bots, () => []),
      harnessUsage("day").then((answer) => ({ groups: answer.groups, total: answer.total }), () => ({ groups: [] as UsageGroupView[], total: null })),
      harnessActivity().then((answer) => answer.activity, () => []),
      account ? myMemberships(account.token).then((answer) => answer.memberships, () => []) : Promise.resolve([]),
    ]).then(([session, health, edition, config, sessions, bots, usage, activity, memberships]) => {
      if (!live) return;
      setSession(session);
      if (!session.admin) {
        setLoading(false);
        return;
      }
      const seatEmails = (async (): Promise<string[]> => {
        if (!account || memberships.length === 0) return [];
        const last = rememberedWorkspace();
        const picked = memberships.find((row) => row.workspace === last) ?? memberships[0]!;
        return workspaceSeats(account.token, picked.workspace)
          .then((payload) => toSeatViews(payload).members.map((member) => member.email), () => []);
      })();
      void seatEmails.then((emails) => {
        if (!live) return;
        const lists = toSignInLists(config);
        const costs = usage.groups.map((group) => group.costUsd);
        const useCost = costs.some((cost) => cost !== null && cost > 0);
        const trend = usage.groups.map((group) => (useCost ? group.costUsd : group.input + group.output));
        const totalTokens = usage.total ? usage.total.input + usage.total.output : 0;
        setModel({
          metrics: {
            totalUsers: uniqueEmails([...lists.admins, ...lists.members, ...sessions.map((row) => row.email), ...emails]),
            activeSessions: sessions.length,
            bots: bots.length,
            workspaces: memberships.length,
            monthTokens: `${totalTokens.toLocaleString()} tokens`,
            monthCost: usage.total?.costUsd === null || usage.total?.costUsd === undefined ? null : `$${usage.total.costUsd.toFixed(2)}`,
          },
          trend,
          trendLabel: useCost ? t("console.dashboard.trendCost") : t("console.dashboard.trendTokens"),
          activity,
          edition: session.admin ? edition.edition : t("console.account.roleMember"),
          healthy: health.ok,
        });
        setLoading(false);
      }).catch(() => {
        if (!live) return;
        setError(t("console.somethingWrong"));
        setLoading(false);
      });
    }).catch(() => {
      if (!live) return;
      setError(t("console.somethingWrong"));
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  if (loading && !model) return <LoadingState />;
  if (!session || session.kind === "none") {
    return (
      <div>
        <p className="mt-3 text-[14px] text-ink-secondary">{t("console.harness.needsSession")}</p>
        <a href={HARNESS_SIGN_IN} className="mt-5 block w-full rounded-md bg-accent px-4 py-2 text-center text-[14px] font-medium text-accent-ink no-underline">
          {t("console.harness.openSignin")}
        </a>
      </div>
    );
  }
  if (!session.admin) return <EmptyState title={t("console.harness.adminOnly")} />;
  return <OverviewView model={model} loading={loading} error={error} />;
}
