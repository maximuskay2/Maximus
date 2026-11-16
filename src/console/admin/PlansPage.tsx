import { useEffect, useState } from "react";

import { t } from "../../lib/i18n";
import type { LocaleKey } from "../../locales";
import {
  adminPlans,
  createPlan,
  HARNESS_SIGN_IN,
  harnessSession,
  HarnessError,
  KNOWN_ENTITLEMENTS,
  updatePlan,
  type AdminPlan,
  type AdminPlanInput,
  type HarnessSessionView,
} from "../harness";
import { ConsoleError as ErrorBox } from "../shell";
import { DataTable, EmptyState, LoadingState, Modal } from "./ui";

export interface PlanForm {
  id: string;
  name: string;
  blurb: string;
  features: string;
  baseUsd: string;
  allowanceUsd: string;
  hardCapUsd: string;
  entitlements: string[];
}

export function planFormOf(plan: AdminPlan | null): PlanForm {
  return {
    id: plan?.id ?? "",
    name: plan?.name ?? "",
    blurb: plan?.blurb ?? "",
    features: plan ? plan.features.join("\n") : "",
    baseUsd: plan ? String(plan.baseUsd) : "",
    allowanceUsd: plan ? String(plan.allowanceUsd) : "",
    hardCapUsd: plan?.hardCapUsd === null || plan?.hardCapUsd === undefined ? "" : String(plan.hardCapUsd),
    entitlements: plan ? [...plan.entitlements] : [],
  };
}

function money(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function validatePlanForm(form: PlanForm, existing: AdminPlan[], originalId: string | null): LocaleKey | null {
  const id = form.id.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(id)) return "console.dashboard.planInvalidId";
  if (id !== originalId && existing.some((row) => row.id === id)) return "console.dashboard.planTaken";
  if (!form.name.trim()) return "console.dashboard.planInvalidName";
  const base = money(form.baseUsd);
  const allowance = money(form.allowanceUsd);
  if (base === null || allowance === null) return "console.dashboard.planInvalidMoney";
  if (form.hardCapUsd.trim()) {
    const cap = money(form.hardCapUsd);
    if (cap === null || cap < allowance) return "console.dashboard.planInvalidCap";
  }
  if (form.features.split("\n").map((line) => line.trim()).filter(Boolean).length > 24) {
    return "console.dashboard.planInvalidFeatures";
  }
  return null;
}

export function planInputOf(form: PlanForm): AdminPlanInput {
  return {
    id: form.id.trim().toLowerCase(),
    name: form.name.trim(),
    blurb: form.blurb.trim(),
    features: form.features.split("\n").map((line) => line.trim()).filter(Boolean),
    baseUsd: Number(form.baseUsd),
    allowanceUsd: Number(form.allowanceUsd),
    hardCapUsd: form.hardCapUsd.trim() ? Number(form.hardCapUsd) : null,
    entitlements: [...form.entitlements],
  };
}

const ENTITLEMENT_LABELS: Record<string, string> = {
  whitelabel: "White label",
  sso: "Single sign-on",
  admin: "Admin console",
  budgets: "Spend caps",
  billing: "Billable usage",
  gateway: "Bundled models",
  agentOsMachines: "Agent OS on this computer and named computers",
};

export function PlanModal({ original, existing, busy, serverError, onClose, onSubmit }: {
  original: AdminPlan | null;
  existing: AdminPlan[];
  busy: boolean;
  serverError: string | null;
  onClose: () => void;
  onSubmit: (input: AdminPlanInput) => void;
}) {
  const [form, setForm] = useState<PlanForm>(() => planFormOf(original));
  const [touched, setTouched] = useState(false);
  const problem = validatePlanForm(form, existing, original?.id ?? null);
  const set = (patch: Partial<PlanForm>): void => setForm((current) => ({ ...current, ...patch }));
  const input = "mt-1 w-full rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[14px] outline-none focus:border-accent-border disabled:opacity-50";
  const label = "mt-4 block text-[12px] font-medium text-ink-secondary";
  return (
    <Modal title={t(original ? "console.dashboard.planEdit" : "console.dashboard.planAdd")} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (validatePlanForm(form, existing, original?.id ?? null)) return;
          onSubmit(planInputOf(form));
        }}
      >
        <div className="grid gap-x-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="dashboard-plan-id">{t("console.dashboard.planId")}</label>
            <input
              id="dashboard-plan-id" className={`${input} font-mono text-[13px]`}
              value={form.id} disabled={busy || Boolean(original)} autoComplete="off" spellCheck={false} maxLength={31}
              placeholder="team" onChange={(event) => set({ id: event.target.value.toLowerCase() })}
            />
          </div>
          <div>
            <label className={label} htmlFor="dashboard-plan-name">{t("console.dashboard.planName")}</label>
            <input
              id="dashboard-plan-name" className={input}
              value={form.name} disabled={busy} maxLength={80}
              placeholder="Team" onChange={(event) => set({ name: event.target.value })}
            />
          </div>
        </div>
        <label className={label} htmlFor="dashboard-plan-blurb">{t("console.dashboard.planBlurb")}</label>
        <input
          id="dashboard-plan-blurb" className={input}
          value={form.blurb} disabled={busy} maxLength={280}
          placeholder={t("console.dashboard.planBlurbHint")} onChange={(event) => set({ blurb: event.target.value })}
        />
        <div className="grid gap-x-3 sm:grid-cols-3">
          <div>
            <label className={label} htmlFor="dashboard-plan-base">{t("console.dashboard.planBase")}</label>
            <input
              id="dashboard-plan-base" className={`${input} tabular-nums`} inputMode="decimal"
              value={form.baseUsd} disabled={busy} placeholder="20"
              onChange={(event) => set({ baseUsd: event.target.value })}
            />
          </div>
          <div>
            <label className={label} htmlFor="dashboard-plan-allowance">{t("console.dashboard.planAllowance")}</label>
            <input
              id="dashboard-plan-allowance" className={`${input} tabular-nums`} inputMode="decimal"
              value={form.allowanceUsd} disabled={busy} placeholder="20"
              onChange={(event) => set({ allowanceUsd: event.target.value })}
            />
          </div>
          <div>
            <label className={label} htmlFor="dashboard-plan-cap">{t("console.dashboard.planCap")}</label>
            <input
              id="dashboard-plan-cap" className={`${input} tabular-nums`} inputMode="decimal"
              value={form.hardCapUsd} disabled={busy} placeholder={t("console.dashboard.planCapHint")}
              onChange={(event) => set({ hardCapUsd: event.target.value })}
            />
          </div>
        </div>
        <fieldset className="mt-4">
          <legend className="text-[12px] font-medium text-ink-secondary">{t("console.dashboard.planEntitlements")}</legend>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {KNOWN_ENTITLEMENTS.map((id) => (
              <label key={id} className="flex items-center gap-2 text-[14px]">
                <input
                  type="checkbox" checked={form.entitlements.includes(id)} disabled={busy}
                  onChange={(event) => {
                    const next = new Set(form.entitlements);
                    if (event.target.checked) next.add(id);
                    else next.delete(id);
                    set({ entitlements: [...next] });
                  }}
                />
                {ENTITLEMENT_LABELS[id] ?? id}
              </label>
            ))}
          </div>
        </fieldset>
        <label className={label} htmlFor="dashboard-plan-features">{t("console.dashboard.planFeatures")}</label>
        <textarea
          id="dashboard-plan-features" rows={4} className={`${input} text-[13px]`} value={form.features} disabled={busy} spellCheck={false}
          placeholder={t("console.dashboard.planFeaturesHint")} onChange={(event) => set({ features: event.target.value })}
        />
        {touched && problem && <p role="alert" className="mt-3 text-[13px] text-danger">{t(problem)}</p>}
        {serverError && <p role="alert" className="mt-3 text-[13px] text-danger">{serverError}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded-md border border-hairline/40 px-4 py-2 text-[14px] text-ink-secondary" disabled={busy} onClick={onClose}>
            {t("console.dashboard.cancel")}
          </button>
          <button type="submit" className="rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50" disabled={busy || Boolean(problem)}>
            {busy ? t("console.sending") : t(original ? "console.dashboard.save" : "console.dashboard.planAdd")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PlansPage() {
  const [session, setSession] = useState<HarnessSessionView | null>(null);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [modal, setModal] = useState<AdminPlan | { fresh: true } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const refresh = (): void => {
    adminPlans().then((answer) => {
      setPlans(answer.plans);
      setBusy(false);
    }, (thrown: unknown) => {
      setModalError(thrown instanceof HarnessError ? thrown.message : t("console.somethingWrong"));
      setBusy(false);
    });
  };

  useEffect(() => {
    let live = true;
    harnessSession().then((current) => {
      if (!live) return;
      setSession(current);
      if (current.kind === "none" || !current.admin) {
        setLoading(false);
        return;
      }
      adminPlans().then((answer) => {
        if (!live) return;
        setPlans(answer.plans);
        setLoading(false);
      }, () => {
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

  const priced = plans.filter((plan) => plan.baseUsd > 0).length;
  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-hairline/40 px-4 py-3">
          <p className="text-[12px] font-medium text-ink-secondary">{t("console.dashboard.navPlans")}</p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums">{plans.length}</p>
        </div>
        <div className="rounded-md border border-hairline/40 px-4 py-3">
          <p className="text-[12px] font-medium text-ink-secondary">{t("console.dashboard.planBase")}</p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums">{priced}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-[220px] flex-1 text-[13px] text-ink-secondary">{t("console.dashboard.plansHint")}</p>
        <button
          type="button"
          className="rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            setModalError(null);
            setModal({ fresh: true });
          }}
        >
          {t("console.dashboard.planAdd")}
        </button>
      </div>
      <h2 id="plans-table" className="sr-only">{t("console.dashboard.navPlans")}</h2>
      <DataTable
        labelledBy="plans-table"
        columns={[
          { key: "name", header: t("console.dashboard.planName"), sortable: true, render: (row) => (<span><span className="font-medium">{row.name}</span> <span className="font-mono text-[12px] text-ink-secondary">{row.id}</span></span>) },
          { key: "baseUsd", header: t("console.dashboard.planBase"), sortable: true, render: (row) => (<span className="tabular-nums">${row.baseUsd}/mo</span>) },
          { key: "allowanceUsd", header: t("console.dashboard.planAllowance"), sortable: true, render: (row) => (<span className="tabular-nums">${row.allowanceUsd}</span>) },
          { key: "cap", header: t("console.pricing.hardCap"), render: (row) => (<span className="tabular-nums text-ink-secondary">{row.hardCapUsd === null ? "—" : `$${row.hardCapUsd}`}</span>) },
          { key: "source", header: t("console.dashboard.colDetail"), sortable: true, render: (row) => (<span className="text-ink-secondary">{row.source}</span>) },
          {
            key: "actions", header: "", render: (row) => (row.editable ? (
              <button
                type="button" className="text-[13px] text-accent underline disabled:opacity-50" disabled={busy}
                onClick={() => {
                  setModalError(null);
                  setModal(row);
                }}
              >
                {t("console.dashboard.edit")}
              </button>
            ) : null),
          },
        ]}
        rows={plans}
        emptyTitle={t("console.dashboard.noPlans")}
        valueOf={(row, key) => {
          if (key === "baseUsd") return row.baseUsd;
          if (key === "allowanceUsd") return row.allowanceUsd;
          if (key === "source") return row.source;
          return row.name;
        }}
      />
      <ErrorBox message={error} />
      {modal && (
        <PlanModal
          original={"fresh" in modal ? null : modal}
          existing={plans}
          busy={busy}
          serverError={modalError}
          onClose={() => {
            if (!busy) setModal(null);
          }}
          onSubmit={(input) => {
            setBusy(true);
            setModalError(null);
            const save = "fresh" in modal ? createPlan(input) : updatePlan(modal.id, input);
            save.then(() => {
              setModal(null);
              refresh();
            }, (thrown: unknown) => {
              setModalError(thrown instanceof HarnessError ? thrown.message : t("console.somethingWrong"));
              setBusy(false);
            });
          }}
        />
      )}
    </div>
  );
}
