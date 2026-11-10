import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { t } from "@/lib/i18n";
import { Select } from "@/components/Select";
import { ServiceEndpointPicker } from "@/console/ServiceEndpoint";
import type { LocaleKey } from "@/locales";
import { formatUsd } from "@/lib/usage";
import {
  consoleAccount,
  ConsoleError,
  consolePlans,
  getConsoleWorkspace,
  normalizeConsoleEmail,
  rememberedWorkspace,
  rememberWorkspace,
  revokeInvite,
  sendInvite,
  setWorkspaceProviders,
  startOtp,
  validConsoleEmail,
  validOtpCode,
  validWorkspaceId,
  verifyOtp,
  workspaceEntitlements,
  workspaceProviders,
  workspaceSeats,
  workspaceSpend,
  type ConsoleAccount,
  type ConsolePlanView,
  type ConsoleWorkspace,
  type WorkspaceProviderState,
} from "@/console/account";
import { Card } from "./SettingsPrimitives";
import { CopyLink } from "./PeopleSection";

export interface EntitlementStateView {
  plan: string;
  granted: string[];
  status: string;
  banner: { kind: string; title: string; body: string } | null;
}

export interface SpendStateView {
  period: string;
  spent: number;
  allowance: number | null;
  remaining: number | null;
  overage: number;
}

export interface SeatMemberView {
  userId: string;
  email: string;
  name: string;
  role: string;
}

export interface SeatInviteView {
  id: string;
  email: string;
  role: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function toEntitlementView(payload: unknown): EntitlementStateView | null {
  const view = asRecord(asRecord(payload).entitlements);
  if (typeof view.plan !== "string" || !Array.isArray(view.granted) || typeof view.status !== "string") return null;
  const banner = asRecord(view.banner);
  return {
    plan: view.plan,
    granted: view.granted.filter((id): id is string => typeof id === "string"),
    status: view.status,
    banner: typeof banner.title === "string" && typeof banner.body === "string"
      ? { kind: typeof banner.kind === "string" ? banner.kind : "info", title: banner.title, body: banner.body }
      : null,
  };
}

export function toSpendView(payload: unknown): SpendStateView | null {
  const spend = asRecord(asRecord(payload).spend);
  if (typeof spend.period !== "string" || typeof spend.spent !== "number") return null;
  return {
    period: spend.period,
    spent: spend.spent,
    allowance: typeof spend.allowance === "number" ? spend.allowance : null,
    remaining: typeof spend.remaining === "number" ? spend.remaining : null,
    overage: typeof spend.overage === "number" ? spend.overage : 0,
  };
}

export function toSeatViews(payload: unknown): { members: SeatMemberView[]; invites: SeatInviteView[] } {
  const seats = asRecord(asRecord(payload).seats);
  const members = Array.isArray(seats.roster) ? seats.roster : [];
  const invites = Array.isArray(seats.invites) ? seats.invites : [];
  return {
    members: members.flatMap((row: unknown) => {
      const member = asRecord(row);
      return typeof member.userId === "string" && typeof member.email === "string" && typeof member.role === "string"
        ? [{ userId: member.userId, email: member.email, name: typeof member.name === "string" ? member.name : "", role: member.role }]
        : [];
    }),
    invites: invites.flatMap((row: unknown) => {
      const invite = asRecord(row);
      return typeof invite.id === "string" && typeof invite.email === "string" && typeof invite.role === "string"
        ? [{ id: invite.id, email: invite.email, role: invite.role }]
        : [];
    }),
  };
}

export function spendLine(spend: SpendStateView): string {
  if (spend.allowance === null) return t("console.account.allowanceNone");
  return t("console.account.allowanceLine", {
    spent: formatUsd(spend.spent / 100),
    allowance: formatUsd(spend.allowance / 100),
  });
}

export function planDisplayName(planId: string, plans: ConsolePlanView[]): string {
  return plans.find((plan) => plan.id === planId)?.name ?? planId;
}

export function ConnectView({ busy, error, sent, email, code, onEmail, onCode, onSend, onVerify }: {
  busy: boolean;
  error: string | null;
  sent: boolean;
  email: string;
  code: string;
  onEmail: (value: string) => void;
  onCode: (value: string) => void;
  onSend: () => void;
  onVerify: () => void;
}) {
  return (
    <Card title={t("settings.section.workspaceAccount")} subtitle={t("console.account.signInFirst")}>
      {!sent && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSend();
          }}
        >
          <label className="block text-[12px] font-medium text-ink-secondary" htmlFor="console-account-email">{t("console.email")}</label>
          <input
            id="console-account-email"
            className="mt-1 w-full rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[14px] outline-none focus:border-accent-border"
            type="email"
            autoComplete="email"
            value={email}
            disabled={busy}
            onChange={(event) => onEmail(event.target.value)}
          />
          <button type="submit" className="mt-3 rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50" disabled={busy || !validConsoleEmail(email)}>
            {busy ? t("console.sending") : t("console.sendCode")}
          </button>
        </form>
      )}
      {sent && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onVerify();
          }}
        >
          <p className="text-[13px] text-ink-secondary">{t("console.codeSent", { email })}</p>
          <label className="mt-3 block text-[12px] font-medium text-ink-secondary" htmlFor="console-account-code">{t("console.code")}</label>
          <input
            id="console-account-code"
            className="mt-1 w-full rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[14px] outline-none focus:border-accent-border"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            disabled={busy}
            onChange={(event) => onCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
          />
          <button type="submit" className="mt-3 rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50" disabled={busy || !validOtpCode(code)}>
            {busy ? t("console.verifying") : t("console.verifyCode")}
          </button>
        </form>
      )}
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      <details className="mt-3 text-[13px] text-ink-secondary">
        <summary className="cursor-pointer underline">{t("console.endpoint.title")}</summary>
        <div className="mt-2"><ServiceEndpointPicker /></div>
      </details>
    </Card>
  );
}

const MODE_LABEL: Record<WorkspaceProviderState["mode"], LocaleKey> = {
  off: "console.account.modeOff",
  byo: "console.account.modeByo",
  bundled: "console.account.modeBundled",
};

export function ProvidersView({ providers, admin, busy, onMode }: {
  providers: WorkspaceProviderState[];
  admin: boolean;
  busy: boolean;
  onMode: (id: string, mode: WorkspaceProviderState["mode"]) => void;
}) {
  if (providers.length === 0) return null;
  return (
    <Card title={t("console.account.providers")}>
      <ul className="space-y-3">
        {providers.map((provider) => (
          <li key={provider.id} className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[14px] font-medium capitalize">{provider.id}</div>
              {provider.reason && <div className="text-[12px] text-ink-secondary">{provider.reason}</div>}
            </div>
            <Select
              aria-label={provider.id}
              size="sm"
              value={provider.mode}
              disabled={busy || !admin}
              title={admin ? "" : t("console.account.adminOnly")}
              onChange={(event) => onMode(provider.id, event.target.value as WorkspaceProviderState["mode"])}
            >
              {(Object.keys(MODE_LABEL) as WorkspaceProviderState["mode"][]).map((mode) => (
                <option key={mode} value={mode}>{t(MODE_LABEL[mode])}</option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function WorkspaceAccountSection() {
  const [account, setAccount] = useState<ConsoleAccount | null>(() => consoleAccount.load());
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [workspaceId, setWorkspaceId] = useState(rememberedWorkspace);
  const [workspace, setWorkspace] = useState<ConsoleWorkspace | null>(null);
  const [entitlements, setEntitlements] = useState<EntitlementStateView | null>(null);
  const [spend, setSpend] = useState<SpendStateView | null>(null);
  const [providers, setProviders] = useState<WorkspaceProviderState[]>([]);
  const [members, setMembers] = useState<SeatMemberView[]>([]);
  const [invites, setInvites] = useState<SeatInviteView[]>([]);
  const [plans, setPlans] = useState<ConsolePlanView[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((thrown: unknown): void => {
    setError(thrown instanceof ConsoleError ? thrown.message : t("console.somethingWrong"));
    setBusy(false);
  }, []);

  const load = useCallback(async (current: ConsoleAccount, id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const [found, entitled, burned, routed, seated, catalog] = await Promise.all([
        getConsoleWorkspace(current.token, id),
        workspaceEntitlements(current.token, id).then(toEntitlementView, () => null),
        workspaceSpend(current.token, id).then(toSpendView, () => null),
        workspaceProviders(current.token, id).then((answer) => answer.providers, () => [] as WorkspaceProviderState[]),
        workspaceSeats(current.token, id).then(toSeatViews, () => ({ members: [], invites: [] })),
        consolePlans().then((answer) => answer.plans, () => [] as ConsolePlanView[]),
      ]);
      setWorkspace(found.workspace);
      setEntitlements(entitled);
      setSpend(burned);
      setProviders(routed);
      setMembers(seated.members);
      setInvites(seated.invites);
      setPlans(catalog);
      rememberWorkspace(id);
      setBusy(false);
    } catch (thrown) {
      fail(thrown);
    }
  }, [fail]);

  useEffect(() => {
    if (account && validWorkspaceId(workspaceId)) void load(account, workspaceId.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!account) {
    return (
      <ConnectView
        busy={busy}
        error={error}
        sent={sent}
        email={email}
        code={code}
        onEmail={(value) => {
          setEmail(value);
          setError(null);
        }}
        onCode={(value) => {
          setCode(value);
          setError(null);
        }}
        onSend={() => {
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
              setSent(true);
              setBusy(false);
            })
            .catch(fail);
        }}
        onVerify={() => {
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
              setAccount(next);
              setBusy(false);
            })
            .catch(fail);
        }}
      />
    );
  }

  const admin = workspace?.role === "admin";
  const planName = entitlements ? planDisplayName(entitlements.plan, plans) : null;

  return (
    <div className="space-y-4">
      <Card title={t("settings.section.workspaceAccount")}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label={t("console.account.whichWorkspace")}
            className="min-w-[200px] flex-1 rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[14px] outline-none focus:border-accent-border"
            value={workspaceId}
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
            onChange={(event) => setWorkspaceId(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          />
          <button
            type="button"
            aria-label={t("console.account.refresh")}
            className="rounded-md border border-hairline/40 px-3 py-2 text-[13px] text-ink-secondary disabled:opacity-50"
            disabled={busy || !validWorkspaceId(workspaceId)}
            onClick={() => void load(account, workspaceId.trim())}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
          <span className="text-[13px] text-ink-secondary">{account.email}</span>
          <button
            type="button"
            className="text-[13px] text-ink-secondary underline"
            onClick={() => {
              consoleAccount.clear();
              setAccount(null);
              setWorkspace(null);
            }}
          >
            {t("console.account.disconnect")}
          </button>
        </div>
        {workspace && (
          <div className="mt-3 space-y-1 text-[14px]">
            <div>
              <span className="font-medium">{workspace.displayName || workspace.id}</span>
              <span className="text-ink-secondary"> · {workspace.role === "admin" ? t("console.account.roleAdmin") : t("console.account.roleMember")}</span>
            </div>
            {planName && (
              <div className="text-ink-secondary">
                {t("console.account.plan")}: {planName}
                {entitlements?.plan === "free" ? ` · ${t("console.account.free")}` : ""}
              </div>
            )}
            {entitlements?.banner && (
              <p role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]">
                <span className="font-medium">{entitlements.banner.title}</span> — {entitlements.banner.body}
              </p>
            )}
            {entitlements?.plan === "free" && (
              <p className="text-[13px] text-ink-secondary">
                {t("console.account.freeLimits")} <a className="underline" href="/pricing">{t("console.account.upgrade")}</a>
              </p>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      </Card>

      {spend && (
        <Card title={t("console.account.allowance")}>
          <p className="text-[14px]">{spendLine(spend)}</p>
          <p className="mt-1 text-[12px] text-ink-secondary">{spend.period}</p>
        </Card>
      )}

      <ProvidersView
        providers={providers}
        admin={admin}
        busy={busy}
        onMode={(id, mode) => {
          setBusy(true);
          setError(null);
          setWorkspaceProviders(account.token, workspaceId.trim(), { [id]: { mode } })
            .then(({ providers: next }) => {
              setProviders(next);
              setBusy(false);
            })
            .catch(fail);
        }}
      />

      {admin && (
        <Card title={t("console.account.invites")}>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const normalized = normalizeConsoleEmail(inviteEmail);
              if (!validConsoleEmail(normalized)) {
                setError(t("console.invalidEmail"));
                return;
              }
              setBusy(true);
              setError(null);
              setInviteLink(null);
              sendInvite(account.token, { workspace: workspaceId.trim(), email: normalized, role: inviteRole })
                .then(({ token }) => {
                  setInviteLink(`${window.location.origin}/join?token=${token}`);
                  setInviteEmail("");
                  setBusy(false);
                  return workspaceSeats(account.token, workspaceId.trim()).then(toSeatViews, () => null);
                })
                .then((seats) => {
                  if (seats) {
                    setMembers(seats.members);
                    setInvites(seats.invites);
                  }
                })
                .catch(fail);
            }}
          >
            <div className="min-w-[200px] flex-1">
              <label className="block text-[12px] font-medium text-ink-secondary" htmlFor="console-invite-email">{t("console.account.inviteEmail")}</label>
              <input
                id="console-invite-email"
                className="mt-1 w-full rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[14px] outline-none focus:border-accent-border"
                type="email"
                value={inviteEmail}
                disabled={busy}
                onChange={(event) => setInviteEmail(event.target.value)}
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-ink-secondary" htmlFor="console-invite-role">{t("console.account.inviteRole")}</label>
              <Select
                id="console-invite-role"
                className="mt-1"
                value={inviteRole}
                disabled={busy}
                onChange={(event) => setInviteRole(event.target.value as "admin" | "member")}
              >
                <option value="member">{t("console.account.roleMember")}</option>
                <option value="admin">{t("console.account.roleAdmin")}</option>
              </Select>
            </div>
            <button type="submit" className="rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50" disabled={busy || !validConsoleEmail(inviteEmail)}>
              {t("console.account.inviteSend")}
            </button>
          </form>
          {inviteLink && (
            <div className="mt-3">
              <p className="text-[13px] text-ink-secondary">{t("console.account.inviteSent")}</p>
              <CopyLink link={inviteLink} />
            </div>
          )}
        </Card>
      )}

      {(members.length > 0 || invites.length > 0) && (
        <Card title={t("console.account.members")}>
          <ul className="space-y-2">
            {members.map((member) => (
              <li key={member.userId} className="flex items-center justify-between gap-3 text-[14px]">
                <span>{member.email} <span className="text-ink-secondary">· {member.role === "admin" ? t("console.account.roleAdmin") : t("console.account.roleMember")}</span></span>
                {admin && (
                  <button
                    type="button"
                    className="text-[13px] text-danger underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      setError(null);
                      revokeInvite(account.token, { workspace: workspaceId.trim(), userId: member.userId })
                        .then(() => load(account, workspaceId.trim()))
                        .catch(fail);
                    }}
                  >
                    {t("console.account.inviteRevoke")}
                  </button>
                )}
              </li>
            ))}
            {invites.map((invite) => (
              <li key={invite.id} className="flex items-center justify-between gap-3 text-[14px] text-ink-secondary">
                <span>{invite.email} <span>· {t("console.account.invites")}</span></span>
                {admin && (
                  <button
                    type="button"
                    className="text-[13px] text-danger underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      setError(null);
                      revokeInvite(account.token, { workspace: workspaceId.trim(), inviteId: invite.id })
                        .then(() => load(account, workspaceId.trim()))
                        .catch(fail);
                    }}
                  >
                    {t("console.account.inviteRevoke")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
