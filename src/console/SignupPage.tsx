import { useEffect, useState } from "react";

import { productName } from "../lib/brand";
import { Select } from "../components/Select";
import { t } from "../lib/i18n";
import {
  consoleAccount,
  ConsoleError,
  consolePlans,
  createWorkspace,
  normalizeConsoleEmail,
  startOtp,
  validConsoleEmail,
  validOtpCode,
  validWorkspaceId,
  verifyOtp,
  type ConsolePlanView,
  type ConsoleWorkspace,
} from "./account";
import { SiteShell } from "../site/SiteShell";
import { ConsoleError as ErrorBox, ConsoleShell, fieldInput, fieldLabel, ghostButton, primaryButton } from "./shell";

export type SignupStep = "email" | "code" | "workspace" | "done";

export interface SignupViewProps {
  step: SignupStep;
  email: string;
  code: string;
  workspaceId: string;
  displayName: string;
  plan: string;
  plans: ConsolePlanView[];
  created: ConsoleWorkspace | null;
  busy: boolean;
  error: string | null;
  onEmail: (value: string) => void;
  onCode: (value: string) => void;
  onWorkspaceId: (value: string) => void;
  onDisplayName: (value: string) => void;
  onPlan: (value: string) => void;
  onSendCode: () => void;
  onVerifyCode: () => void;
  onCreate: () => void;
  onBackToEmail: () => void;
}

export function SignupView(props: SignupViewProps) {
  const app = productName();
  if (props.step === "done" && props.created) {
    return (
      <ConsoleShell marketing compact title={t("console.signup.doneTitle", { workspace: props.created.id })}>
        <p className="mt-3 text-[14px] text-ink-secondary">{t("console.signup.doneBody", { app })}</p>
        <a href="/admin" className={`${primaryButton} mt-6 block text-center no-underline`}>
          {t("console.manageWorkspace")}
        </a>
        <a href="/" className="mt-3 block text-center text-[13px] text-ink-secondary">
          {t("console.signup.openApp", { app })}
        </a>
      </ConsoleShell>
    );
  }
  return (
    <ConsoleShell marketing compact title={t("console.signup.title", { app })} subtitle={t("console.signup.subtitle")}>
      {props.step === "email" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            props.onSendCode();
          }}
        >
          <label className={fieldLabel} htmlFor="console-signup-email">{t("console.email")}</label>
          <input
            id="console-signup-email"
            className={fieldInput}
            type="email"
            autoComplete="email"
            value={props.email}
            disabled={props.busy}
            onChange={(event) => props.onEmail(event.target.value)}
          />
          <button type="submit" className={primaryButton} disabled={props.busy || !validConsoleEmail(props.email)}>
            {props.busy ? t("console.sending") : t("console.sendCode")}
          </button>
        </form>
      )}
      {props.step === "code" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            props.onVerifyCode();
          }}
        >
          <p className="mt-3 text-[13px] text-ink-secondary">{t("console.codeSent", { email: props.email })}</p>
          <label className={fieldLabel} htmlFor="console-signup-code">{t("console.code")}</label>
          <input
            id="console-signup-code"
            className={fieldInput}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={props.code}
            disabled={props.busy}
            onChange={(event) => props.onCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
          />
          <button type="submit" className={primaryButton} disabled={props.busy || !validOtpCode(props.code)}>
            {props.busy ? t("console.verifying") : t("console.verifyCode")}
          </button>
          <button type="button" className={ghostButton} disabled={props.busy} onClick={props.onBackToEmail}>
            {t("console.useAnotherEmail")}
          </button>
        </form>
      )}
      {props.step === "workspace" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            props.onCreate();
          }}
        >
          <label className={fieldLabel} htmlFor="console-signup-workspace">{t("console.signup.workspaceId")}</label>
          <input
            id="console-signup-workspace"
            className={fieldInput}
            autoComplete="off"
            spellCheck={false}
            value={props.workspaceId}
            disabled={props.busy}
            onChange={(event) => props.onWorkspaceId(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          />
          <p className="mt-1 text-[12px] text-ink-faint">{t("console.signup.workspaceIdHint")}</p>
          <label className={fieldLabel} htmlFor="console-signup-name">{t("console.signup.displayName")}</label>
          <input
            id="console-signup-name"
            className={fieldInput}
            autoComplete="organization"
            value={props.displayName}
            disabled={props.busy}
            onChange={(event) => props.onDisplayName(event.target.value)}
          />
          <label className={fieldLabel} htmlFor="console-signup-plan">{t("console.signup.plan")}</label>
          <Select
            id="console-signup-plan"
            className="mt-1 w-full"
            value={props.plan}
            disabled={props.busy}
            onChange={(event) => props.onPlan(event.target.value)}
          >
            {props.plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
                {plan.baseUsd > 0 ? ` — $${plan.baseUsd}/mo` : ` — ${t("console.free")}`}
              </option>
            ))}
          </Select>
          <button type="submit" className={primaryButton} disabled={props.busy || !validWorkspaceId(props.workspaceId)}>
            {props.busy ? t("console.signup.creating") : t("console.signup.create")}
          </button>
        </form>
      )}
      <ErrorBox message={props.error} />
      <p className="mt-5 text-center text-[12px] text-ink-faint">
        <a href="/signin">{t("console.signup.haveAccount")}</a>
        {" · "}
        <a href="/pricing">{t("console.signup.viewPlans")}</a>
      </p>
    </ConsoleShell>
  );
}

function initialPlan(): string {
  if (typeof window === "undefined") return "free";
  const plan = new URLSearchParams(window.location.search).get("plan");
  return plan && /^[a-z][a-z0-9-]{1,30}$/.test(plan) ? plan : "free";
}

export function SignupPage() {
  const [step, setStep] = useState<SignupStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [plan, setPlan] = useState(initialPlan);
  const [plans, setPlans] = useState<ConsolePlanView[]>([]);
  const [created, setCreated] = useState<ConsoleWorkspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    consolePlans()
      .then(({ plans: listed }) => {
        if (!live) return;
        setPlans(listed);
        setPlan((current) => (listed.some((listedPlan) => listedPlan.id === current) ? current : "free"));
      })
      .catch(() => {
        if (live) setPlans([{ id: "free", name: "Free", blurb: "", baseUsd: 0, allowanceUsd: 0, hardCapUsd: null, entitlements: [], features: [] }]);
      });
    return () => {
      live = false;
    };
  }, []);

  const fail = (thrown: unknown): void => {
    setError(thrown instanceof ConsoleError ? thrown.message : t("console.somethingWrong"));
    setBusy(false);
  };

  return (
    <SiteShell>
    <SignupView
      step={step}
      email={email}
      code={code}
      workspaceId={workspaceId}
      displayName={displayName}
      plan={plan}
      plans={plans}
      created={created}
      busy={busy}
      error={error}
      onEmail={(value) => {
        setEmail(value);
        setError(null);
      }}
      onCode={(value) => {
        setCode(value);
        setError(null);
      }}
      onWorkspaceId={(value) => {
        setWorkspaceId(value);
        setError(null);
      }}
      onDisplayName={setDisplayName}
      onPlan={setPlan}
      onBackToEmail={() => {
        setStep("email");
        setCode("");
        setError(null);
      }}
      onSendCode={() => {
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
          .catch(fail);
      }}
      onVerifyCode={() => {
        if (!validOtpCode(code)) {
          setError(t("console.invalidCode"));
          return;
        }
        setBusy(true);
        setError(null);
        verifyOtp(normalizeConsoleEmail(email), code.trim())
          .then(({ token, user }) => {
            consoleAccount.save({ token, email: user.email });
            setStep("workspace");
            setBusy(false);
          })
          .catch(fail);
      }}
      onCreate={() => {
        const account = consoleAccount.load();
        if (!account) {
          setStep("email");
          setError(t("console.sessionExpired"));
          return;
        }
        if (!validWorkspaceId(workspaceId)) {
          setError(t("console.signup.invalidWorkspaceId"));
          return;
        }
        setBusy(true);
        setError(null);
        createWorkspace(account.token, {
          workspace: workspaceId.trim(),
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
          plan,
        })
          .then(({ workspace }) => {
            setCreated(workspace);
            setStep("done");
            setBusy(false);
          })
          .catch(fail);
      }}
    />
    </SiteShell>
  );
}
