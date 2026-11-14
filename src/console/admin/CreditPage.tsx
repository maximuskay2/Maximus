import { useEffect, useState } from "react";

import { t } from "../../lib/i18n";
import type { LocaleKey } from "../../locales";
import { Select } from "../../components/Select";
import { validConsoleEmail } from "../account";
import {
  adminGrants,
  grantAccount,
  HARNESS_SIGN_IN,
  harnessSession,
  HarnessError,
  type AccountGrantBody,
  type AccountSeatView,
} from "../harness";
import { DataTable, EmptyState, LoadingState } from "./ui";

const field = "mt-1 w-full rounded-md border border-hairline/60 bg-app px-3 py-2 text-[14px]";
const PLANS = ["", "byo", "starter", "plus", "pro"] as const;

export function creditFormProblem(email: string, plan: string, credit: string, tokens: string): LocaleKey | null {
  if (!validConsoleEmail(email)) return "console.dashboard.creditInvalid";
  const amount = credit.trim() === "" ? 0 : Number(credit);
  const count = tokens.trim() === "" ? 0 : Number(tokens);
  if (!Number.isFinite(amount) || amount < 0) return "console.dashboard.creditAmountBad";
  if (!Number.isInteger(count) || count < 0) return "console.dashboard.creditTokensBad";
  if (!plan && amount <= 0 && count <= 0) return "console.dashboard.creditNeed";
  return null;
}

function planLabel(plan: AccountSeatView["plan"]): string {
  if (plan === "byo") return t("console.dashboard.creditPlanByo");
  if (plan === "starter") return t("console.dashboard.creditPlanStarter");
  if (plan === "plus") return t("console.dashboard.creditPlanPlus");
  if (plan === "pro") return t("console.dashboard.creditPlanPro");
  return "—";
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function CreditForm({ busy, serverError, onSubmit }: {
  busy: boolean;
  serverError: string | null;
  onSubmit: (body: AccountGrantBody) => void;
}) {
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState("");
  const [credit, setCredit] = useState("");
  const [tokens, setTokens] = useState("");
  const [note, setNote] = useState("");
  const [renew, setRenew] = useState(false);
  const [touched, setTouched] = useState(false);
  const problem = creditFormProblem(email, plan, credit, tokens);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (creditFormProblem(email, plan, credit, tokens)) return;
        const amount = credit.trim() === "" ? 0 : Number(credit);
        const count = tokens.trim() === "" ? 0 : Number(tokens);
        onSubmit({
          email: email.trim().toLowerCase(),
          ...(plan === "byo" || plan === "starter" || plan === "plus" || plan === "pro" ? { plan } : {}),
          ...(amount > 0 ? { creditUsd: amount } : {}),
          ...(count > 0 ? { tokens: count } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(renew ? { renew: true } : {}),
        });
      }}
    >
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-[12px] font-medium text-ink-secondary" htmlFor="credit-email">
          {t("console.dashboard.creditEmail")}
          <input id="credit-email" className={field} autoComplete="off" spellCheck={false} value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="block text-[12px] font-medium text-ink-secondary" htmlFor="credit-plan">
          {t("console.dashboard.creditPlan")}
          <Select id="credit-plan" className="mt-1 w-full" value={plan} disabled={busy} onChange={(event) => setPlan(event.target.value)}>
            {PLANS.map((id) => (
              <option key={id || "keep"} value={id}>{t(id === "byo" ? "console.dashboard.creditPlanByo" : id === "starter" ? "console.dashboard.creditPlanStarter" : id === "plus" ? "console.dashboard.creditPlanPlus" : id === "pro" ? "console.dashboard.creditPlanPro" : "console.dashboard.creditPlanKeep")}</option>
            ))}
          </Select>
        </label>
        <label className="block text-[12px] font-medium text-ink-secondary" htmlFor="credit-amount">
          {t("console.dashboard.creditAmount")}
          <input id="credit-amount" className={field} inputMode="decimal" value={credit} disabled={busy} onChange={(event) => setCredit(event.target.value)} />
        </label>
        <label className="block text-[12px] font-medium text-ink-secondary" htmlFor="credit-tokens">
          {t("console.dashboard.creditTokens")}
          <input id="credit-tokens" className={field} inputMode="numeric" value={tokens} disabled={busy} onChange={(event) => setTokens(event.target.value)} />
        </label>
      </div>
      <label className="mt-3 block text-[12px] font-medium text-ink-secondary" htmlFor="credit-note">
        {t("console.dashboard.creditNote")}
        <input id="credit-note" className={field} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} />
      </label>
      <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-secondary" htmlFor="credit-renew">
        <input id="credit-renew" type="checkbox" checked={renew} disabled={busy} onChange={(event) => setRenew(event.target.checked)} />
        {t("console.dashboard.creditRenew")}
      </label>
      {touched && problem ? <p role="alert" className="mt-3 text-[13px] text-danger">{t(problem)}</p> : null}
      {serverError ? <p role="alert" className="mt-3 text-[13px] text-danger">{serverError}</p> : null}
      <button type="submit" className="mt-4 rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50" disabled={busy}>
        {busy ? t("console.sending") : t("console.dashboard.creditSave")}
      </button>
    </form>
  );
}

export function CreditPage() {
  const [ready, setReady] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [rows, setRows] = useState<AccountSeatView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    harnessSession().then((session) => {
      if (!live) return;
      setSignedIn(session.kind !== "none");
      setAdmin(session.admin === true);
      if (session.kind === "none" || !session.admin) {
        setReady(true);
        return;
      }
      return adminGrants().then((answer) => {
        if (!live) return;
        setRows(answer.grants);
        setReady(true);
      });
    }).catch((thrown: unknown) => {
      if (!live) return;
      setError(thrown instanceof HarnessError ? thrown.message : t("console.somethingWrong"));
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!ready) return <LoadingState />;
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

  return (
    <div>
      <p className="text-[13px] text-ink-secondary">{t("console.dashboard.creditHint")}</p>
      <CreditForm
        busy={busy}
        serverError={error}
        onSubmit={(body) => {
          setBusy(true);
          setError(null);
          setNotice(null);
          grantAccount(body).then((answer) => {
            setRows(answer.grants);
            setNotice(t("console.dashboard.creditSaved"));
            setBusy(false);
          }, (thrown: unknown) => {
            setError(thrown instanceof HarnessError ? thrown.message : t("console.somethingWrong"));
            setBusy(false);
          });
        }}
      />
      {notice ? <p role="status" className="mt-3 text-[13px] text-ink-secondary">{notice}</p> : null}
      <h2 id="credit-accounts" className="mt-8 text-[15px] font-semibold">{t("console.dashboard.navCredit")}</h2>
      <DataTable
        labelledBy="credit-accounts"
        emptyTitle={t("console.dashboard.creditEmpty")}
        rows={rows.map((row) => ({ ...row, id: row.email }))}
        valueOf={(row, key) => {
          if (key === "creditUsd" || key === "leftUsd") return row[key];
          if (key === "plan") return row.plan ?? "";
          if (key === "note") return row.note;
          return row.email;
        }}
        columns={[
          { key: "email", header: t("console.dashboard.creditEmail"), sortable: true, render: (row) => row.email },
          { key: "plan", header: t("console.dashboard.creditColPlan"), sortable: true, render: (row) => planLabel(row.plan) },
          { key: "creditUsd", header: t("console.dashboard.creditColCredit"), sortable: true, render: (row) => money(row.creditUsd) },
          { key: "leftUsd", header: t("console.dashboard.creditColLeft"), sortable: true, render: (row) => money(row.leftUsd) },
          { key: "note", header: t("console.dashboard.creditColNote"), render: (row) => row.note || "—" },
        ]}
      />
    </div>
  );
}
