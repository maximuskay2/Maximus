import { useEffect, useState } from "react";

import { productName } from "../lib/brand";
import { t } from "../lib/i18n";
import {
  consoleAccount,
  ConsoleError,
  myMemberships,
  normalizeConsoleEmail,
  rememberedWorkspace,
  rememberWorkspace,
  signInMethods,
  socialAccountFromHash,
  startOtp,
  startSocial,
  validConsoleEmail,
  validOtpCode,
  verifyOtp,
  type ConsoleMembership,
  type SignInMethod,
} from "./account";
import { SiteShell } from "../site/SiteShell";
import { ConsoleError as ErrorBox, ConsoleShell, fieldInput, fieldLabel, ghostButton, primaryButton } from "./shell";
import { ServiceEndpointPicker } from "./ServiceEndpoint";

export type SigninStep = "email" | "code" | "workspace";

export interface SigninViewProps {
  step: SigninStep;
  email: string;
  code: string;
  memberships: ConsoleMembership[];
  busy: boolean;
  error: string | null;
  onEmail: (value: string) => void;
  onCode: (value: string) => void;
  onSendCode: () => void;
  onVerifyCode: () => void;
  onBackToEmail: () => void;
  onPick: (workspace: string) => void;
  providers?: SignInMethod[];
  onProvider?: (id: string) => void;
}

/** Only same-origin app paths survive; anything else falls back to the workspace dashboard. */
export function signinNextPath(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//") && raw.length <= 200) return raw;
  return "/admin";
}

export function SigninView(props: SigninViewProps) {
  const app = productName();
  return (
    <ConsoleShell marketing compact title={t("console.signin.title", { app })} subtitle={t("console.signin.subtitle")}>
      {props.step === "email" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            props.onSendCode();
          }}
        >
          <label className={fieldLabel} htmlFor="console-signin-email">{t("console.email")}</label>
          <input
            id="console-signin-email"
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
          {(props.providers ?? []).filter((method) => method.id !== "email").map((method) => (
            <button
              key={method.id}
              type="button"
              className={ghostButton}
              disabled={props.busy}
              onClick={() => props.onProvider?.(method.id)}
            >
              {t("console.signin.continueWith", { provider: method.label })}
            </button>
          ))}
          <details className="mt-4 text-[13px] text-ink-secondary">
            <summary className="cursor-pointer underline">{t("console.endpoint.title")}</summary>
            <div className="mt-2"><ServiceEndpointPicker /></div>
          </details>
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
          <label className={fieldLabel} htmlFor="console-signin-code">{t("console.code")}</label>
          <input
            id="console-signin-code"
            className={fieldInput}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={props.code}
            disabled={props.busy}
            onChange={(event) => props.onCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
          />
          <button type="submit" className={primaryButton} disabled={props.busy || !validOtpCode(props.code)}>
            {props.busy ? t("console.verifying") : t("console.signin.signIn")}
          </button>
          <button type="button" className={ghostButton} disabled={props.busy} onClick={props.onBackToEmail}>
            {t("console.useAnotherEmail")}
          </button>
        </form>
      )}
      {props.step === "workspace" && (
        <div>
          {props.memberships.length === 0 ? (
            <div>
              <p className="mt-3 text-[14px] text-ink-secondary">{t("console.signin.noWorkspaces")}</p>
              <a href="/signup" className={`${primaryButton} mt-5 block text-center no-underline`}>
                {t("console.signin.createWorkspace")}
              </a>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {props.memberships.map((membership) => (
                <li key={membership.workspace}>
                  <button
                    type="button"
                    className="w-full rounded-md border border-hairline/40 px-3 py-2 text-left disabled:opacity-50"
                    disabled={props.busy}
                    onClick={() => props.onPick(membership.workspace)}
                  >
                    <span className="block text-[14px] font-medium">{membership.displayName || membership.workspace}</span>
                    <span className="block text-[12px] text-ink-secondary">
                      {membership.role === "admin" ? t("console.account.roleAdmin") : t("console.account.roleMember")}
                      {" · "}
                      {membership.plan}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ErrorBox message={props.error} />
      <p className="mt-5 text-center text-[12px] text-ink-faint">
        <a href="/signup">{t("console.signin.needWorkspace")}</a>
        {" · "}
        <a href="/pricing">{t("console.signup.viewPlans")}</a>
      </p>
    </ConsoleShell>
  );
}

function initialNext(): string {
  if (typeof window === "undefined") return "/admin";
  return signinNextPath(new URLSearchParams(window.location.search).get("next"));
}

export function SigninPage() {
  const [step, setStep] = useState<SigninStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [memberships, setMemberships] = useState<ConsoleMembership[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [next] = useState(initialNext);
  const [providers, setProviders] = useState<SignInMethod[]>([]);

  const fail = (thrown: unknown): void => {
    if (thrown instanceof ConsoleError && (thrown.code === "signed_out" || thrown.code === "unauthorized")) {
      consoleAccount.clear();
      setStep("email");
    }
    setError(thrown instanceof ConsoleError ? thrown.message : t("console.somethingWrong"));
    setBusy(false);
  };

  const loadMemberships = (token: string): void => {
    setBusy(true);
    setError(null);
    myMemberships(token)
      .then(({ memberships: rows }) => {
        setMemberships(rows);
        setBusy(false);
        const last = rememberedWorkspace();
        if (rows.length === 1 && rows[0] && (last === rows[0].workspace || !last)) {
          rememberWorkspace(rows[0].workspace);
          window.location.assign(next);
          return;
        }
        setStep("workspace");
      })
      .catch(fail);
  };

  useEffect(() => {
    const arrived = socialAccountFromHash(window.location.hash);
    if (arrived) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      consoleAccount.save(arrived);
      setEmail(arrived.email);
      loadMemberships(arrived.token);
      return;
    }
    const account = consoleAccount.load();
    if (account) {
      setEmail(account.email);
      loadMemberships(account.token);
    }
    signInMethods().then(({ methods }) => setProviders(methods)).catch(() => setProviders([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SiteShell>
    <SigninView
      step={step}
      email={email}
      code={code}
      memberships={memberships}
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
            loadMemberships(token);
          })
          .catch(fail);
      }}
      onPick={(workspace) => {
        rememberWorkspace(workspace);
        window.location.assign(next);
      }}
      providers={providers}
      onProvider={(provider) => {
        const callbackURL = `${window.location.origin}/signin`;
        setBusy(true);
        setError(null);
        startSocial(provider, callbackURL)
          .then(({ url }) => { window.location.assign(url); })
          .catch(fail);
      }}
    />
    </SiteShell>
  );
}
