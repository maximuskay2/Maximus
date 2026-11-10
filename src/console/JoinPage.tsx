import { useState } from "react";

import { productName } from "../lib/brand";
import { t } from "../lib/i18n";
import {
  acceptInvite,
  consoleAccount,
  ConsoleError,
  normalizeConsoleEmail,
  startOtp,
  validConsoleEmail,
  validOtpCode,
  verifyOtp,
  type ConsoleWorkspace,
} from "./account";
import { SiteShell } from "../site/SiteShell";
import { ConsoleError as ErrorBox, ConsoleShell, fieldInput, fieldLabel, ghostButton, primaryButton } from "./shell";

export type JoinStep = "email" | "code" | "done";

export interface JoinViewProps {
  step: JoinStep;
  email: string;
  code: string;
  joined: ConsoleWorkspace | null;
  busy: boolean;
  error: string | null;
  onEmail: (value: string) => void;
  onCode: (value: string) => void;
  onSendCode: () => void;
  onVerifyCode: () => void;
  onBackToEmail: () => void;
}

export function inviteTokenFromLocation(search: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  for (const key of ["token", "invite"]) {
    const value = (params.get(key) ?? "").trim();
    if (/^[A-Za-z0-9_-]{20,128}$/.test(value)) return value;
  }
  return null;
}

export function JoinView(props: JoinViewProps) {
  const app = productName();
  if (props.step === "done" && props.joined) {
    return (
      <ConsoleShell marketing compact title={t("console.join.doneTitle", { workspace: props.joined.id })}>
        <p className="mt-3 text-[14px] text-ink-secondary">{t("console.join.doneBody", { app })}</p>
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
    <ConsoleShell marketing compact title={t("console.join.title", { app })} subtitle={t("console.join.subtitle")}>
      {props.step === "email" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            props.onSendCode();
          }}
        >
          <p className="mt-3 text-[13px] text-ink-secondary">{t("console.join.emailHint")}</p>
          <label className={fieldLabel} htmlFor="console-join-email">{t("console.email")}</label>
          <input
            id="console-join-email"
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
          <label className={fieldLabel} htmlFor="console-join-code">{t("console.code")}</label>
          <input
            id="console-join-code"
            className={fieldInput}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={props.code}
            disabled={props.busy}
            onChange={(event) => props.onCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
          />
          <button type="submit" className={primaryButton} disabled={props.busy || !validOtpCode(props.code)}>
            {props.busy ? t("console.verifying") : t("console.join.verifyAndJoin")}
          </button>
          <button type="button" className={ghostButton} disabled={props.busy} onClick={props.onBackToEmail}>
            {t("console.useAnotherEmail")}
          </button>
        </form>
      )}
      <ErrorBox message={props.error} />
    </ConsoleShell>
  );
}

export function JoinPage() {
  const [inviteToken] = useState(() => (typeof window === "undefined" ? null : inviteTokenFromLocation(window.location.search)));
  const [step, setStep] = useState<JoinStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [joined, setJoined] = useState<ConsoleWorkspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!inviteToken) {
    return (
      <SiteShell>
        <ConsoleShell marketing compact title={t("console.join.title", { app: productName() })}>
          <ErrorBox message={t("console.join.missingToken")} />
          <a href="/signup" className="mt-4 block text-center text-[13px] text-ink-secondary">{t("console.join.signupInstead")}</a>
        </ConsoleShell>
      </SiteShell>
    );
  }

  const fail = (thrown: unknown): void => {
    setError(thrown instanceof ConsoleError ? thrown.message : t("console.somethingWrong"));
    setBusy(false);
  };

  return (
    <SiteShell>
    <JoinView
      step={step}
      email={email}
      code={code}
      joined={joined}
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
        const normalized = normalizeConsoleEmail(email);
        verifyOtp(normalized, code.trim())
          .then(({ token, user }) => {
            consoleAccount.save({ token, email: user.email });
            return acceptInvite(token, inviteToken);
          })
          .then(({ workspace }) => {
            setJoined(workspace);
            setStep("done");
            setBusy(false);
          })
          .catch(fail);
      }}
    />
    </SiteShell>
  );
}
