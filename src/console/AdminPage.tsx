import { useEffect, useRef, useState } from "react";

import { t } from "../lib/i18n";
import { Select } from "../components/Select";
import { formatUsd } from "../lib/usage";
import { CopyLink } from "../components/PeopleSection";
import {
  planDisplayName,
  ProvidersView,
  spendLine,
  toEntitlementView,
  toSeatViews,
  toSpendView,
  type EntitlementStateView,
  type SeatInviteView,
  type SeatMemberView,
  type SpendStateView,
} from "../components/WorkspaceAccountSection";
import {
  consoleAccount,
  ConsoleError,
  consolePlans,
  getConsoleWorkspace,
  myMemberships,
  normalizeConsoleEmail,
  rememberedWorkspace,
  rememberWorkspace,
  revokeInvite,
  sendInvite,
  setWorkspaceProvider,
  startOtp,
  validConsoleEmail,
  validOtpCode,
  verifyOtp,
  workspaceAudit,
  workspaceEntitlements,
  workspaceInstallations,
  workspaceProviders,
  workspaceRouting,
  workspaceSeats,
  workspaceSpend,
  workspaceUsage,
  type ConsoleAccount,
  type ConsoleMembership,
  type ConsolePlanView,
  type ConsoleWorkspace,
  type WorkspaceProviderState,
} from "./account";
import { adminSessionOpen, harnessSession } from "./harness";
import { AdminPasswordGate } from "./admin/Gate";
import { ConsoleError as ErrorBox, ConsoleShell, fieldInput, fieldLabel, ghostButton, primaryButton } from "./shell";
import { OverviewPage } from "./admin/OverviewPage";
import { CreditPage } from "./admin/CreditPage";
import { PlansPage } from "./admin/PlansPage";
import { RatesPage } from "./admin/RatesPage";
import { KeysPage, MessagesPage, SettingsPage } from "./admin/ServerPages";
import { DashboardShell, dashboardViewFromParam, type DashboardView } from "./admin/Shell";
import { UsersPage } from "./admin/UsersPage";

export interface AdminInstallationView {
  id: string;
  name: string;
  platform: string;
  appVersion: string;
  ownerEmail: string;
  createdAt: number;
  lastSeenAt: number | null;
}

export interface AdminAuditView {
  id: string;
  actor: string;
  action: string;
  createdAt: number;
}

export interface AdminSpendPoint {
  period: string;
  amount: number;
}

export interface AdminRoutingView {
  id: string;
  allowed: boolean;
  via: string;
  operatorEnabled: boolean;
  workspaceMode: string;
  reason?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function toInstallationViews(payload: unknown): AdminInstallationView[] {
  const rows = asRecord(asRecord(payload).installations).installations;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown): AdminInstallationView[] => {
    const record = asRecord(row);
    if (typeof record.id !== "string" || !record.id) return [];
    return [{
      id: record.id,
      name: asString(record.name) || asString(record.clientInstanceId) || record.id,
      platform: asString(record.platform),
      appVersion: asString(record.appVersion),
      ownerEmail: asString(record.ownerEmail),
      createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
      lastSeenAt: typeof record.lastSeenAt === "number" ? record.lastSeenAt : null,
    }];
  });
}

export function toAuditViews(payload: unknown): AdminAuditView[] {
  const rows = asRecord(asRecord(payload).audit).entries;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown): AdminAuditView[] => {
    const record = asRecord(row);
    if (typeof record.id !== "string" || typeof record.action !== "string") return [];
    return [{
      id: record.id,
      actor: asString(record.actor),
      action: record.action,
      createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
    }];
  });
}

export function toSpendHistory(payload: unknown): AdminSpendPoint[] {
  const rows = asRecord(asRecord(payload).usage).history;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown): AdminSpendPoint[] => {
    const record = asRecord(row);
    return typeof record.period === "string" && typeof record.amount === "number"
      ? [{ period: record.period, amount: record.amount }]
      : [];
  });
}

export function toAdminRouting(payload: unknown): AdminRoutingView[] {
  const routes = asRecord(asRecord(payload).routing).providers;
  return Object.entries(asRecord(routes)).flatMap(([id, entry]): AdminRoutingView[] => {
    if (!/^[a-z]+$/.test(id)) return [];
    const record = asRecord(entry);
    const reason = typeof record.reason === "string" && record.reason ? record.reason : undefined;
    return [{
      id,
      allowed: record.allowed === true,
      via: asString(record.via) || "off",
      operatorEnabled: record.operatorEnabled !== false,
      workspaceMode: asString(record.workspaceMode) || "byo",
      ...(reason ? { reason } : {}),
    }];
  }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function formatWhen(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

export interface AdminDashboard {
  email: string;
  memberships: ConsoleMembership[];
  workspaceId: string;
  workspace: ConsoleWorkspace | null;
  entitlements: EntitlementStateView | null;
  spend: SpendStateView | null;
  history: AdminSpendPoint[];
  providers: WorkspaceProviderState[];
  members: SeatMemberView[];
  invites: SeatInviteView[];
  installations: AdminInstallationView[];
  audit: AdminAuditView[];
  routing: AdminRoutingView[];
  plans: ConsolePlanView[];
}

export interface AdminViewProps {
  signedIn: boolean;
  loading: boolean;
  dashboard: AdminDashboard | null;
  inviteEmail: string;
  inviteRole: "admin" | "member";
  inviteLink: string | null;
  busy: boolean;
  error: string | null;
  onWorkspace: (workspace: string) => void;
  onSignOut: () => void;
  onMode: (id: string, mode: WorkspaceProviderState["mode"]) => void;
  onInviteEmail: (value: string) => void;
  onInviteRole: (role: "admin" | "member") => void;
  onSendInvite: () => void;
  onRevokeUser: (userId: string) => void;
  onRevokeInvite: (inviteId: string) => void;
}

const sectionTitle = "text-[15px] font-semibold";
const muted = "text-[13px] text-ink-secondary";

export function AdminFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-app px-6 py-10 text-ink">
      <div className="mx-auto w-full max-w-[860px]">
        <h1 className="text-[20px] font-semibold">{title}</h1>
        {subtitle ? <p className="mt-1 text-[13px] text-ink-secondary">{subtitle}</p> : null}
        {children}
      </div>
    </main>
  );
}

export function AdminView(props: AdminViewProps) {
  if (!props.signedIn) {
    return (
      <ConsoleShell title={t("console.admin.title")}>
        <p className="mt-3 text-[14px] text-ink-secondary">{t("console.admin.needsSignin")}</p>
        <a href="/signin?next=/admin" className={`${primaryButton} mt-5 block text-center no-underline`}>
          {t("console.admin.needsSigninCta")}
        </a>
      </ConsoleShell>
    );
  }
  if (props.loading || !props.dashboard) {
    return (
      <ConsoleShell title={t("console.admin.title")}>
        <p role="status" className="mt-3 text-[14px] text-ink-secondary">{t("console.loading")}</p>
        <ErrorBox message={props.error} />
      </ConsoleShell>
    );
  }
  const dashboard = props.dashboard;
  const admin = dashboard.workspace?.role === "admin";
  const planName = dashboard.entitlements ? planDisplayName(dashboard.entitlements.plan, dashboard.plans) : null;
  return (
    <AdminFrame title={t("console.admin.title")} subtitle={dashboard.email}>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Select
          aria-label={t("console.admin.workspace")}
          className="min-w-[220px]"
          value={dashboard.workspaceId}
          disabled={props.busy}
          onChange={(event) => props.onWorkspace(event.target.value)}
        >
          {dashboard.memberships.map((membership) => (
            <option key={membership.workspace} value={membership.workspace}>
              {membership.displayName || membership.workspace}
              {" · "}
              {membership.role === "admin" ? t("console.account.roleAdmin") : t("console.account.roleMember")}
            </option>
          ))}
        </Select>
        <span className={muted}>
          {dashboard.workspace?.displayName || dashboard.workspaceId}
          {dashboard.workspace ? ` · ${dashboard.workspace.role === "admin" ? t("console.account.roleAdmin") : t("console.account.roleMember")}` : ""}
        </span>
        <span className="flex-1" />
        <a href="/" className="text-[13px] text-ink-secondary underline">{t("console.admin.viewApp")}</a>
        <button type="button" className="text-[13px] text-ink-secondary underline" onClick={props.onSignOut}>
          {t("console.admin.signOut")}
        </button>
      </div>
      <ErrorBox message={props.error} />

      <section className="mt-8">
        <h2 className={sectionTitle}>{t("console.admin.overview")}</h2>
        {dashboard.entitlements?.banner && (
          <p role="status" className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]">
            <span className="font-medium">{dashboard.entitlements.banner.title}</span> — {dashboard.entitlements.banner.body}
          </p>
        )}
        <dl className="mt-3 grid gap-3 text-[14px] sm:grid-cols-3">
          <div>
            <dt className={muted}>{t("console.account.plan")}</dt>
            <dd className="font-medium">{planName ?? dashboard.entitlements?.plan ?? "—"}</dd>
          </div>
          <div>
            <dt className={muted}>{t("console.admin.status")}</dt>
            <dd className="font-medium">{dashboard.entitlements?.status ?? "—"}</dd>
          </div>
          <div>
            <dt className={muted}>{t("console.account.allowance")}</dt>
            <dd className="font-medium">{dashboard.spend ? spendLine(dashboard.spend) : "—"}</dd>
          </div>
        </dl>
        {dashboard.entitlements?.plan === "free" && (
          <p className={`mt-2 ${muted}`}>
            {t("console.account.freeLimits")} <a className="underline" href="/pricing">{t("console.account.upgrade")}</a>
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className={sectionTitle}>{t("console.account.providers")}</h2>
        {!admin && <p className={`mt-2 ${muted}`}>{t("console.account.adminOnly")}</p>}
        <div className="mt-3">
          <ProvidersView providers={dashboard.providers} admin={admin} busy={props.busy} onMode={props.onMode} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className={sectionTitle}>{t("console.admin.seats")}</h2>
        {!admin ? (
          <p className={`mt-2 ${muted}`}>{t("console.admin.memberOnly")}</p>
        ) : (
          <div className="mt-3">
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                props.onSendInvite();
              }}
            >
              <div className="min-w-[220px] flex-1">
                <label className="block text-[12px] font-medium text-ink-secondary" htmlFor="console-admin-invite-email">{t("console.account.inviteEmail")}</label>
                <input
                  id="console-admin-invite-email"
                  className="mt-1 w-full rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[14px] outline-none focus:border-accent-border"
                  type="email"
                  value={props.inviteEmail}
                  disabled={props.busy}
                  onChange={(event) => props.onInviteEmail(event.target.value)}
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-ink-secondary" htmlFor="console-admin-invite-role">{t("console.account.inviteRole")}</label>
                <Select
                  id="console-admin-invite-role"
                  className="mt-1"
                  value={props.inviteRole}
                  disabled={props.busy}
                  onChange={(event) => props.onInviteRole(event.target.value as "admin" | "member")}
                >
                  <option value="member">{t("console.account.roleMember")}</option>
                  <option value="admin">{t("console.account.roleAdmin")}</option>
                </Select>
              </div>
              <button type="submit" className="rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50" disabled={props.busy || !validConsoleEmail(props.inviteEmail)}>
                {t("console.account.inviteSend")}
              </button>
            </form>
            {props.inviteLink && (
              <div className="mt-3">
                <p className={muted}>{t("console.account.inviteSent")}</p>
                <CopyLink link={props.inviteLink} />
              </div>
            )}
            <ul className="mt-4 space-y-2">
              {dashboard.members.map((member) => (
                <li key={member.userId} className="flex items-center justify-between gap-3 text-[14px]">
                  <span>{member.email} <span className="text-ink-secondary">· {member.role === "admin" ? t("console.account.roleAdmin") : t("console.account.roleMember")}</span></span>
                  <button
                    type="button"
                    className="text-[13px] text-danger underline disabled:opacity-50"
                    disabled={props.busy}
                    onClick={() => props.onRevokeUser(member.userId)}
                  >
                    {t("console.account.inviteRevoke")}
                  </button>
                </li>
              ))}
              {dashboard.invites.map((invite) => (
                <li key={invite.id} className="flex items-center justify-between gap-3 text-[14px] text-ink-secondary">
                  <span>{invite.email} <span>· {t("console.account.invites")}</span></span>
                  <button
                    type="button"
                    className="text-[13px] text-danger underline disabled:opacity-50"
                    disabled={props.busy}
                    onClick={() => props.onRevokeInvite(invite.id)}
                  >
                    {t("console.account.inviteRevoke")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {admin && (
        <section className="mt-8">
          <h2 className={sectionTitle}>{t("console.admin.spendHistory")}</h2>
          {dashboard.history.length === 0 ? (
            <p className={`mt-2 ${muted}`}>{t("console.admin.noHistory")}</p>
          ) : (
            <table className="mt-3 w-full max-w-[420px] text-[14px]">
              <tbody>
                {dashboard.history.map((point) => (
                  <tr key={point.period} className="border-t border-hairline/40">
                    <td className="py-1.5 pr-3">{point.period}</td>
                    <td className="py-1.5 text-right font-medium">{formatUsd(point.amount / 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {admin && (
        <section className="mt-8">
          <h2 className={sectionTitle}>{t("console.admin.routing")}</h2>
          <table className="mt-3 w-full text-[14px]">
            <thead>
              <tr className={`border-b border-hairline/40 text-left ${muted}`}>
                <th className="py-1.5 pr-3 font-medium">{t("console.account.providers")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("console.admin.via")}</th>
                <th className="py-1.5 font-medium">{t("console.admin.reason")}</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.routing.map((route) => (
                <tr key={route.id} className="border-t border-hairline/40">
                  <td className="py-1.5 pr-3 font-medium capitalize">{route.id}</td>
                  <td className="py-1.5 pr-3">{route.allowed ? route.via : t("console.admin.blocked")}</td>
                  <td className="py-1.5 text-ink-secondary">
                    {!route.operatorEnabled ? t("console.admin.operatorOff") : route.reason ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {admin && (
        <section className="mt-8">
          <h2 className={sectionTitle}>{t("console.admin.installations")}</h2>
          {dashboard.installations.length === 0 ? (
            <p className={`mt-2 ${muted}`}>{t("console.admin.noInstallations")}</p>
          ) : (
            <ul className="mt-3 space-y-2 text-[14px]">
              {dashboard.installations.map((installation) => (
                <li key={installation.id} className="flex flex-wrap items-baseline justify-between gap-3">
                  <span>
                    <span className="font-medium">{installation.name}</span>
                    <span className="text-ink-secondary">
                      {" · "}
                      {installation.platform}
                      {installation.appVersion ? ` ${installation.appVersion}` : ""}
                      {installation.ownerEmail ? ` · ${installation.ownerEmail}` : ""}
                    </span>
                  </span>
                  <span className={muted}>
                    {installation.lastSeenAt ? formatWhen(installation.lastSeenAt) : t("console.admin.neverSeen")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {admin && (
        <section className="mt-8">
          <h2 className={sectionTitle}>{t("console.admin.audit")}</h2>
          {dashboard.audit.length === 0 ? (
            <p className={`mt-2 ${muted}`}>{t("console.admin.noAudit")}</p>
          ) : (
            <ul className="mt-3 space-y-2 text-[14px]">
              {dashboard.audit.slice(0, 50).map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-3">
                  <span>
                    <span className="font-mono text-[13px]">{entry.action}</span>
                    {entry.actor ? <span className="text-ink-secondary"> · {entry.actor}</span> : null}
                  </span>
                  <span className={muted}>{formatWhen(entry.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </AdminFrame>
  );
}

type QuickSigninStep = "email" | "code";

function QuickSignin({ onSignedIn }: { onSignedIn: (account: ConsoleAccount) => void }) {
  const [step, setStep] = useState<QuickSigninStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ConsoleShell title={t("console.admin.title")} subtitle={t("console.admin.needsSignin")}>
      {step === "email" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = normalizeConsoleEmail(email);
            if (!validConsoleEmail(normalized)) {
              setError(t("console.invalidEmail"));
              return;
            }
            setBusy(true);
            setError(null);
            startOtp(normalized)
              .then(({ email: confirmed }) => {
                setEmail(confirmed);
                setStep("code");
                setBusy(false);
              })
              .catch((thrown: unknown) => {
                setError(thrown instanceof ConsoleError ? thrown.message : t("console.somethingWrong"));
                setBusy(false);
              });
          }}
        >
          <label className={fieldLabel} htmlFor="console-admin-email">{t("console.email")}</label>
          <input
            id="console-admin-email"
            className={fieldInput}
            type="email"
            autoComplete="email"
            value={email}
            disabled={busy}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
            }}
          />
          <button type="submit" className={primaryButton} disabled={busy || !validConsoleEmail(email)}>
            {busy ? t("console.sending") : t("console.sendCode")}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!validOtpCode(code)) {
              setError(t("console.invalidCode"));
              return;
            }
            setBusy(true);
            setError(null);
            verifyOtp(normalizeConsoleEmail(email), code.trim())
              .then(({ token, user }) => {
                const next = { token, email: user.email };
                consoleAccount.save(next);
                onSignedIn(next);
              })
              .catch((thrown: unknown) => {
                setError(thrown instanceof ConsoleError ? thrown.message : t("console.somethingWrong"));
                setBusy(false);
              });
          }}
        >
          <p className="mt-3 text-[13px] text-ink-secondary">{t("console.codeSent", { email })}</p>
          <label className={fieldLabel} htmlFor="console-admin-code">{t("console.code")}</label>
          <input
            id="console-admin-code"
            className={fieldInput}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            disabled={busy}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 8));
              setError(null);
            }}
          />
          <button type="submit" className={primaryButton} disabled={busy || !validOtpCode(code)}>
            {busy ? t("console.verifying") : t("console.signin.signIn")}
          </button>
          <button
            type="button"
            className={ghostButton}
            disabled={busy}
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
            }}
          >
            {t("console.useAnotherEmail")}
          </button>
        </form>
      )}
      <ErrorBox message={error} />
    </ConsoleShell>
  );
}

export function WorkspacePage() {
  const [account, setAccount] = useState<ConsoleAccount | null>(() => consoleAccount.load());
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = (): void => {
    consoleAccount.clear();
    setAccount(null);
    setDashboard(null);
  };

  const fail = (thrown: unknown): void => {
    if (thrown instanceof ConsoleError && (thrown.code === "signed_out" || thrown.code === "unauthorized")) {
      signOut();
      return;
    }
    setError(thrown instanceof ConsoleError ? thrown.message : t("console.somethingWrong"));
    setBusy(false);
  };

  const load = async (current: ConsoleAccount, workspaceId: string, memberships: ConsoleMembership[]): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const [found, membershipRows, entitled, burned, routed, seated, catalog] = await Promise.all([
        getConsoleWorkspace(current.token, workspaceId),
        Promise.resolve(memberships),
        workspaceEntitlements(current.token, workspaceId).then(toEntitlementView, () => null),
        workspaceSpend(current.token, workspaceId).then(toSpendView, () => null),
        workspaceProviders(current.token, workspaceId).then((answer) => answer.providers, () => [] as WorkspaceProviderState[]),
        workspaceSeats(current.token, workspaceId).then(toSeatViews, () => ({ members: [], invites: [] })),
        consolePlans().then((answer) => answer.plans, () => [] as ConsolePlanView[]),
      ]);
      const isAdmin = found.workspace.role === "admin";
      const [installations, audit, usage, routing] = isAdmin ? await Promise.all([
        workspaceInstallations(current.token, workspaceId).then(toInstallationViews, () => []),
        workspaceAudit(current.token, workspaceId).then(toAuditViews, () => []),
        workspaceUsage(current.token, workspaceId).catch(() => null),
        workspaceRouting(current.token, workspaceId).then(toAdminRouting, () => []),
      ]) : [[], [], null, []];
      setDashboard({
        email: current.email,
        memberships: membershipRows,
        workspaceId,
        workspace: found.workspace,
        entitlements: entitled,
        spend: burned,
        history: toSpendHistory(usage),
        providers: routed,
        members: seated.members,
        invites: seated.invites,
        installations,
        audit,
        routing,
        plans: catalog,
      });
      rememberWorkspace(workspaceId);
      setBusy(false);
    } catch (thrown) {
      fail(thrown);
    }
  };

  useEffect(() => {
    const current = consoleAccount.load();
    if (!current) return;
    setBusy(true);
    myMemberships(current.token)
      .then(({ memberships }) => {
        if (memberships.length === 0) {
          setBusy(false);
          setError(t("console.signin.noWorkspaces"));
          return;
        }
        const last = rememberedWorkspace();
        const picked = memberships.find((row) => row.workspace === last) ?? memberships[0]!;
        void load(current, picked.workspace, memberships);
      })
      .catch((thrown: unknown) => {
        if (thrown instanceof ConsoleError && (thrown.code === "signed_out" || thrown.code === "unauthorized")) {
          signOut();
          return;
        }
        fail(thrown);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!account) return <QuickSignin onSignedIn={(next) => {
    setAccount(next);
    setBusy(true);
    myMemberships(next.token)
      .then(({ memberships }) => {
        if (memberships.length === 0) {
          setBusy(false);
          setError(t("console.signin.noWorkspaces"));
          return;
        }
        const last = rememberedWorkspace();
        const picked = memberships.find((row) => row.workspace === last) ?? memberships[0]!;
        void load(next, picked.workspace, memberships);
      })
      .catch(fail);
  }} />;

  return (
    <AdminView
      signedIn
      loading={!dashboard}
      dashboard={dashboard}
      inviteEmail={inviteEmail}
      inviteRole={inviteRole}
      inviteLink={inviteLink}
      busy={busy}
      error={error}
      onWorkspace={(workspace) => {
        if (dashboard) void load(account, workspace, dashboard.memberships);
      }}
      onSignOut={signOut}
      onMode={(id, mode) => {
        if (!dashboard) return;
        setBusy(true);
        setError(null);
        setWorkspaceProvider(account.token, dashboard.workspaceId, id, { mode })
          .then(({ providers }) => {
            setDashboard({ ...dashboard, providers });
            setBusy(false);
          })
          .catch(fail);
      }}
      onInviteEmail={(value) => {
        setInviteEmail(value);
        setError(null);
      }}
      onInviteRole={setInviteRole}
      onSendInvite={() => {
        if (!dashboard) return;
        const normalized = normalizeConsoleEmail(inviteEmail);
        if (!validConsoleEmail(normalized)) {
          setError(t("console.invalidEmail"));
          return;
        }
        setBusy(true);
        setError(null);
        setInviteLink(null);
        sendInvite(account.token, { workspace: dashboard.workspaceId, email: normalized, role: inviteRole })
          .then(({ token }) => {
            setInviteLink(`${window.location.origin}/join?token=${token}`);
            setInviteEmail("");
            setBusy(false);
            return workspaceSeats(account.token, dashboard.workspaceId).then(toSeatViews, () => null);
          })
          .then((seats) => {
            if (seats && dashboard) setDashboard({ ...dashboard, members: seats.members, invites: seats.invites });
          })
          .catch(fail);
      }}
      onRevokeUser={(userId) => {
        if (!dashboard) return;
        setBusy(true);
        setError(null);
        revokeInvite(account.token, { workspace: dashboard.workspaceId, userId })
          .then(() => load(account, dashboard.workspaceId, dashboard.memberships))
          .catch(fail);
      }}
      onRevokeInvite={(inviteId) => {
        if (!dashboard) return;
        setBusy(true);
        setError(null);
        revokeInvite(account.token, { workspace: dashboard.workspaceId, inviteId })
          .then(() => load(account, dashboard.workspaceId, dashboard.memberships))
          .catch(fail);
      }}
    />
  );
}

function initialView(): DashboardView {
  if (typeof window === "undefined") return "overview";
  const params = new URLSearchParams(window.location.search);
  // The old two-leg tabs deep-linked ?leg=server: its headline was user management.
  if (params.get("leg") === "server" && !params.get("view")) return "users";
  return dashboardViewFromParam(params.get("view"));
}

export function AdminPage() {
  const [view, setView] = useState<DashboardView>(initialView);
  const [identity, setIdentity] = useState("");
  const [phase, setPhase] = useState<"checking" | "locked" | "open">("checking");
  const watch = useRef(0);

  useEffect(() => {
    let live = true;
    const check = (): void => {
      const mine = ++watch.current;
      harnessSession().then((session) => {
        if (!live || mine !== watch.current) return;
        if (adminSessionOpen(session)) {
          setIdentity(session.email);
          setPhase("open");
          return;
        }
        setIdentity("");
        setPhase((current) => (current === "open" ? "locked" : current === "checking" ? "locked" : current));
      }, () => {
        if (!live || mine !== watch.current) return;
        setIdentity("");
        setPhase((current) => (current === "checking" || current === "open" ? "locked" : current));
      });
    };
    check();
    const timer = window.setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, []);

  const pickView = (next: DashboardView): void => {
    setView(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("leg");
      if (next === "overview") url.searchParams.delete("view");
      else url.searchParams.set("view", next);
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch {
      /* the view still switches; only the deep link is lost */
    }
  };

  const logout = (): void => {
    watch.current += 1;
    consoleAccount.clear();
    setIdentity("");
    setPhase("locked");
    fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  };

  if (phase !== "open") {
    return phase === "checking"
      ? <p role="status" className="grid min-h-screen place-items-center bg-app text-[14px] text-ink-secondary">{t("console.loading")}</p>
      : (
        <AdminPasswordGate onOpen={(email) => {
          watch.current += 1;
          setIdentity(email);
          setPhase("open");
        }} />
      );
  }

  return (
    <DashboardShell view={view} onView={pickView} identity={identity} onLogout={logout}>
      {view === "overview" && <OverviewPage />}
      {view === "users" && <UsersPage />}
      {view === "workspace" && <WorkspacePage />}
      {view === "plans" && <PlansPage />}
      {view === "rates" && <RatesPage />}
      {view === "credit" && <CreditPage />}
      {view === "keys" && <KeysPage />}
      {view === "messages" && <MessagesPage />}
      {view === "settings" && <SettingsPage />}
    </DashboardShell>
  );
}
