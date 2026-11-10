import { useEffect, useState } from "react";
import { Search } from "lucide-react";

import { t } from "../../lib/i18n";
import type { LocaleKey } from "../../locales";
import { toSeatViews } from "../../components/WorkspaceAccountSection";
import { validConsoleEmail } from "../account";
import {
  consoleAccount,
  myMemberships,
  rememberedWorkspace,
  workspaceSeats,
} from "../account";
import { PairingPanel } from "../AdminHarness";
import {
  createHarnessPairing,
  harnessConfig,
  harnessPairings,
  HARNESS_SIGN_IN,
  harnessSession,
  harnessSessions,
  harnessUsage,
  HarnessError,
  revokeHarnessSession,
  saveHarnessConfig,
  toSignInLists,
  type HarnessPairing,
  type HarnessSessionRow,
  type HarnessSessionView,
  type SignInLists,
  type UsageGroupView,
} from "../harness";
import { ConsoleError as ErrorBox } from "../shell";
import { DataTable, EmptyState, LoadingState, Modal } from "./ui";

export interface UserRow {
  id: string;
  email: string;
  label: string;
  kind: "access" | "session" | "member";
  role: "admin" | "member";
  detail: string;
  usage: string;
  sessionId?: string;
  accessEmail?: string;
  current?: boolean;
}

export function buildUserRows(input: {
  lists: SignInLists;
  sessions: HarnessSessionRow[];
  members: { email: string; role: string }[];
  usage: UsageGroupView[];
}): UserRow[] {
  const spend = new Map<string, string>();
  for (const group of input.usage) {
    const tokens = group.input + group.output;
    spend.set(group.key.trim().toLowerCase(), group.costUsd === null ? `${tokens.toLocaleString()} tokens` : `$${group.costUsd.toFixed(2)}`);
  }
  const rows: UserRow[] = [];
  for (const email of input.lists.admins) {
    rows.push({ id: `access:${email}`, email, label: "", kind: "access", role: "admin", detail: t("console.dashboard.userAccess"), usage: spend.get(email.trim().toLowerCase()) ?? "—", accessEmail: email });
  }
  for (const email of input.lists.members) {
    rows.push({ id: `access:${email}`, email, label: "", kind: "access", role: "member", detail: t("console.dashboard.userAccess"), usage: spend.get(email.trim().toLowerCase()) ?? "—", accessEmail: email });
  }
  for (const session of input.sessions) {
    const email = session.email || session.label;
    rows.push({
      id: `session:${session.id}`, email, label: session.email ? session.label : "", kind: "session",
      role: session.scopes.includes("admin") ? "admin" : "member",
      detail: session.current ? t("console.harness.current") : session.scopes.join(", "),
      usage: spend.get(email.trim().toLowerCase()) ?? "—", sessionId: session.id, current: session.current,
    });
  }
  for (const member of input.members) {
    rows.push({
      id: `member:${member.email}`, email: member.email, label: "", kind: "member",
      role: member.role === "admin" ? "admin" : "member", detail: t("console.admin.legWorkspace"),
      usage: spend.get(member.email.trim().toLowerCase()) ?? "—",
    });
  }
  return rows;
}

export function filterUserRows(rows: UserRow[], query: string): UserRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => `${row.email} ${row.label} ${row.kind} ${row.role} ${row.detail}`.toLowerCase().includes(needle));
}

/** An allow-list entry is one address or a whole @domain, like the server's own matcher. */
export function validAccessEntry(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return validConsoleEmail(trimmed) || /^@[^\s@]{1,253}\.[^\s@]{2,}$/.test(trimmed);
}

export function validateUserEntry(email: string, lists: SignInLists, original?: string): LocaleKey | null {
  const trimmed = email.trim().toLowerCase();
  if (!validAccessEntry(trimmed)) return "console.dashboard.userInvalid";
  if (original && trimmed === original.trim().toLowerCase()) return null;
  const taken = [...lists.admins, ...lists.members].some((entry) => entry.trim().toLowerCase() === trimmed);
  return taken ? "console.dashboard.userTaken" : null;
}

export function UserModal({ original, lists, busy, serverError, onClose, onSubmit }: {
  original: { email: string; role: "admin" | "member" } | null;
  lists: SignInLists;
  busy: boolean;
  serverError: string | null;
  onClose: () => void;
  onSubmit: (email: string, role: "admin" | "member") => void;
}) {
  const [email, setEmail] = useState(original?.email ?? "");
  const [role, setRole] = useState<"admin" | "member">(original?.role ?? "member");
  const [touched, setTouched] = useState(false);
  const problem = validateUserEntry(email, lists, original?.email);
  return (
    <Modal title={t(original ? "console.dashboard.userEdit" : "console.dashboard.userAdd")} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (validateUserEntry(email, lists, original?.email)) return;
          onSubmit(email.trim().toLowerCase(), role);
        }}
      >
        <label className="mt-2 block text-[12px] font-medium text-ink-secondary" htmlFor="dashboard-user-email">
          {t("console.email")}
        </label>
        <input
          id="dashboard-user-email"
          type="text"
          autoComplete="off"
          spellCheck={false}
          className="mt-1 w-full rounded-md border border-hairline/40 bg-inset px-3 py-2 font-mono text-[13px] outline-none focus:border-accent-border"
          placeholder="ada@example.com or @example.com"
          value={email}
          disabled={busy}
          onChange={(event) => setEmail(event.target.value)}
        />
        <p className="mt-1 text-[12px] text-ink-faint">{t("console.harness.allowHint")}</p>
        <label className="mt-4 block text-[12px] font-medium text-ink-secondary" htmlFor="dashboard-user-role">
          {t("console.harness.role")}
        </label>
        <select
          id="dashboard-user-role"
          className="mt-1 w-full rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[14px]"
          value={role}
          disabled={busy}
          onChange={(event) => setRole(event.target.value as "admin" | "member")}
        >
          <option value="member">{t("console.account.roleMember")}</option>
          <option value="admin">{t("console.account.roleAdmin")}</option>
        </select>
        {touched && problem && (
          <p role="alert" className="mt-3 text-[13px] text-danger">{t(problem)}</p>
        )}
        {serverError && (
          <p role="alert" className="mt-3 text-[13px] text-danger">{serverError}</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded-md border border-hairline/40 px-4 py-2 text-[14px] text-ink-secondary" disabled={busy} onClick={onClose}>
            {t("console.dashboard.cancel")}
          </button>
          <button type="submit" className="rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50" disabled={busy || Boolean(problem)}>
            {busy ? t("console.sending") : t(original ? "console.dashboard.save" : "console.dashboard.userAdd")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function UsersPage() {
  const [session, setSession] = useState<HarnessSessionView | null>(null);
  const [lists, setLists] = useState<SignInLists>({ admins: [], members: [] });
  const [sessions, setSessions] = useState<HarnessSessionRow[]>([]);
  const [members, setMembers] = useState<{ email: string; role: string }[]>([]);
  const [usage, setUsage] = useState<UsageGroupView[]>([]);
  const [pairings, setPairings] = useState<HarnessPairing[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | UserRow["kind"]>("all");
  const [modal, setModal] = useState<{ email: string; role: "admin" | "member" } | { fresh: true } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    harnessSession().then((current) => {
      if (!live) return;
      setSession(current);
      if (current.kind === "none" || !current.admin) {
        setLoading(false);
        return;
      }
      const account = consoleAccount.load();
      Promise.all([
        harnessConfig().then(toSignInLists, () => ({ admins: [], members: [] }) as SignInLists),
        harnessSessions().then((answer) => answer.sessions, () => [] as HarnessSessionRow[]),
        harnessUsage("user").then((answer) => answer.groups, () => [] as UsageGroupView[]),
        harnessPairings().then((answer) => answer.pairings, () => [] as HarnessPairing[]),
        (async () => {
          if (!account) return [];
          const memberships = await myMemberships(account.token).then((answer) => answer.memberships, () => []);
          if (memberships.length === 0) return [];
          const last = rememberedWorkspace();
          const picked = memberships.find((row) => row.workspace === last) ?? memberships[0]!;
          return workspaceSeats(account.token, picked.workspace)
            .then((payload) => toSeatViews(payload).members.map((member) => ({ email: member.email, role: member.role })), () => []);
        })(),
      ]).then(([nextLists, nextSessions, nextUsage, nextPairings, nextMembers]) => {
        if (!live) return;
        setLists(nextLists);
        setSessions(nextSessions);
        setUsage(nextUsage);
        setPairings(nextPairings);
        setMembers(nextMembers);
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

  const fail = (thrown: unknown): void => {
    setModalError(thrown instanceof HarnessError ? thrown.message : t("console.somethingWrong"));
    setBusy(false);
  };

  const refreshLists = (): void => {
    harnessConfig().then((config) => {
      setLists(toSignInLists(config));
      setBusy(false);
    }, fail);
  };

  if (loading) return <LoadingState />;
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

  const directory = buildUserRows({ lists, sessions, members, usage });
  const rows = filterUserRows(directory, query).filter((row) => kind === "all" || row.kind === kind);
  const kinds: Array<{ id: "all" | UserRow["kind"]; label: "console.dashboard.navUsers" | "console.dashboard.userAccess" | "console.harness.sessions" | "console.admin.legWorkspace" }> = [
    { id: "all", label: "console.dashboard.navUsers" },
    { id: "access", label: "console.dashboard.userAccess" },
    { id: "session", label: "console.harness.sessions" },
    { id: "member", label: "console.admin.legWorkspace" },
  ];
  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-hairline/40 px-4 py-3">
          <p className="text-[12px] font-medium text-ink-secondary">{t("console.harness.admins")}</p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums">{lists.admins.length}</p>
        </div>
        <div className="rounded-md border border-hairline/40 px-4 py-3">
          <p className="text-[12px] font-medium text-ink-secondary">{t("console.harness.members")}</p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums">{lists.members.length}</p>
        </div>
        <div className="rounded-md border border-hairline/40 px-4 py-3">
          <p className="text-[12px] font-medium text-ink-secondary">{t("console.harness.sessions")}</p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums">{sessions.length}</p>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
        {kinds.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={kind === entry.id}
            className={`rounded-full px-3 py-1 text-[13px] ${kind === entry.id ? "bg-accent text-accent-ink" : "border border-hairline/50 text-ink-secondary"}`}
            onClick={() => setKind(entry.id)}
          >
            {t(entry.label)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            aria-label={t("console.dashboard.searchUsers")}
            className="w-full rounded-md border border-hairline/40 bg-inset py-2 pl-9 pr-3 text-[14px] outline-none focus:border-accent-border"
            placeholder={t("console.dashboard.searchUsers")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            setModalError(null);
            setModal({ fresh: true });
          }}
        >
          {t("console.dashboard.userAdd")}
        </button>
      </div>
      <h2 id="users-table" className="sr-only">{t("console.dashboard.navUsers")}</h2>
      <DataTable
        labelledBy="users-table"
        columns={[
          { key: "email", header: t("console.dashboard.colUser"), sortable: true, render: (row) => (<span><span className="font-medium">{row.email}</span>{row.label ? <span className="text-ink-secondary"> · {row.label}</span> : null}</span>) },
          { key: "kind", header: t("console.dashboard.colType"), sortable: true, render: (row) => (<span className="capitalize">{row.kind}</span>) },
          { key: "role", header: t("console.harness.role"), sortable: true, render: (row) => (row.role === "admin" ? t("console.account.roleAdmin") : t("console.account.roleMember")) },
          { key: "detail", header: t("console.dashboard.colDetail"), render: (row) => (<span className="text-ink-secondary">{row.detail || "—"}</span>) },
          { key: "usage", header: t("console.dashboard.colUsage"), render: (row) => (<span className="tabular-nums text-ink-secondary">{row.usage}</span>) },
          {
            key: "actions", header: "", render: (row) => (
              <span className="flex gap-3">
                {row.kind === "access" && row.accessEmail ? (
                  <>
                    <button
                      type="button" className="text-[13px] text-accent underline disabled:opacity-50" disabled={busy}
                      onClick={() => {
                        setModalError(null);
                        setModal({ email: row.accessEmail!, role: row.role });
                      }}
                    >
                      {t("console.dashboard.edit")}
                    </button>
                    <button
                      type="button" className="text-[13px] text-danger underline disabled:opacity-50" disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        setError(null);
                        const drop = (entries: string[]): string[] => entries.filter((entry) => entry.trim().toLowerCase() !== row.accessEmail!.trim().toLowerCase());
                        saveHarnessConfig({ signIn: { admins: drop(lists.admins), members: drop(lists.members) } }).then(refreshLists, fail);
                      }}
                    >
                      {t("console.dashboard.remove")}
                    </button>
                  </>
                ) : null}
                {row.kind === "session" && row.sessionId && !row.current ? (
                  <button
                    type="button" className="text-[13px] text-danger underline disabled:opacity-50" disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      setError(null);
                      revokeHarnessSession(row.sessionId!).then(() => {
                        harnessSessions().then((answer) => {
                          setSessions(answer.sessions);
                          setBusy(false);
                        }, fail);
                      }, fail);
                    }}
                  >
                    {t("console.harness.revoke")}
                  </button>
                ) : null}
              </span>
            ),
          },
        ]}
        rows={rows}
        emptyTitle={query || kind !== "all" ? t("console.dashboard.noUserMatch") : t("console.dashboard.noUsers")}
        valueOf={(row, key) => {
          if (key === "email") return row.email;
          if (key === "kind") return row.kind;
          if (key === "role") return row.role;
          return row.email;
        }}
      />
      <ErrorBox message={error} />
      <section className="mt-8 rounded-lg border border-hairline/40 p-4">
      <h2 className="text-[15px] font-semibold">{t("console.harness.pairings")}</h2>
      <PairingPanel
        pairings={pairings}
        busy={busy}
        onCreate={(label) => {
          setBusy(true);
          setError(null);
          createHarnessPairing(label ? { label } : {})
            .then(() => harnessPairings().then((answer) => {
              setPairings(answer.pairings);
              setBusy(false);
            }, fail))
            .catch(fail);
        }}
      />
      </section>
      {modal && (
        <UserModal
          original={"fresh" in modal ? null : modal}
          lists={lists}
          busy={busy}
          serverError={modalError}
          onClose={() => {
            if (!busy) setModal(null);
          }}
          onSubmit={(email, role) => {
            setBusy(true);
            setModalError(null);
            const original = "fresh" in modal ? undefined : modal.email;
            const drop = (entries: string[]): string[] => (original ? entries.filter((entry) => entry.trim().toLowerCase() !== original.trim().toLowerCase()) : entries);
            const admins = drop(lists.admins);
            const members = drop(lists.members);
            (role === "admin" ? admins : members).push(email);
            saveHarnessConfig({ signIn: { admins, members } }).then(() => {
              setModal(null);
              refreshLists();
            }, fail);
          }}
        />
      )}
    </div>
  );
}
