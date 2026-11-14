import { useState } from "react";

import { productName } from "../lib/brand";
import { t } from "../lib/i18n";
import { SiteShell } from "../site/SiteShell";
import { normalizeConsoleEmail, validConsoleEmail } from "./account";
import { ConsoleError as ErrorBox, ConsoleShell, fieldInput, fieldLabel, primaryButton } from "./shell";

export function ForgotPasswordPage() {
  const app = productName();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  return (
    <SiteShell>
      <ConsoleShell marketing compact title={t("account.forgotTitle", { app })} subtitle={t("account.forgotSubtitle")}>
        {sent ? (
          <p className="mt-3 text-[14px] text-ink-secondary">{t("account.forgotSent", { email })}</p>
        ) : (
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
              void fetch("/api/auth/password/forgot", {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ email: normalized }),
              })
                .then(async (response) => {
                  const body: unknown = await response.json().catch(() => ({}));
                  setBusy(false);
                  if (!response.ok) {
                    const message = Reflect.get(Object(body), "error");
                    setError(typeof message === "string" ? message : t("console.somethingWrong"));
                    return;
                  }
                  setSent(true);
                })
                .catch(() => {
                  setBusy(false);
                  setError(t("console.somethingWrong"));
                });
            }}
          >
            <label className={fieldLabel} htmlFor="forgot-email">{t("console.email")}</label>
            <input
              id="forgot-email"
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
              {busy ? t("account.forgotSending") : t("account.forgotSubmit")}
            </button>
          </form>
        )}
        <ErrorBox message={error} />
        <p className="mt-5 text-center text-[12px] text-ink-faint">
          <a href="/signin">{t("account.backToSignIn")}</a>
        </p>
      </ConsoleShell>
    </SiteShell>
  );
}

export function ResetPasswordPage() {
  const app = productName();
  const token = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("token") ?? "" : "";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <SiteShell>
      <ConsoleShell marketing compact title={t("account.resetTitle", { app })} subtitle={t("account.resetSubtitle")}>
        {!token ? (
          <p className="mt-3 text-[14px] text-ink-secondary">{t("account.resetMissing")}</p>
        ) : done ? (
          <div>
            <p className="mt-3 text-[14px] text-ink-secondary">{t("account.resetDone")}</p>
            <a href="/signin" className={`${primaryButton} mt-5 block text-center no-underline`}>
              {t("accounts.signIn")}
            </a>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (password.length < 8) {
                setError(t("account.passwordShort"));
                return;
              }
              setBusy(true);
              setError(null);
              void fetch("/api/auth/password/reset", {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ token, password }),
              })
                .then(async (response) => {
                  const body: unknown = await response.json().catch(() => ({}));
                  setBusy(false);
                  if (!response.ok) {
                    const message = Reflect.get(Object(body), "error");
                    setError(typeof message === "string" ? message : t("console.somethingWrong"));
                    return;
                  }
                  setDone(true);
                })
                .catch(() => {
                  setBusy(false);
                  setError(t("console.somethingWrong"));
                });
            }}
          >
            <label className={fieldLabel} htmlFor="reset-password">{t("account.password")}</label>
            <input
              id="reset-password"
              className={fieldInput}
              type="password"
              autoComplete="new-password"
              value={password}
              disabled={busy}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
            />
            <button type="submit" className={primaryButton} disabled={busy || password.length < 8}>
              {busy ? t("account.resetSaving") : t("account.resetSubmit")}
            </button>
          </form>
        )}
        <ErrorBox message={error} />
        <p className="mt-5 text-center text-[12px] text-ink-faint">
          <a href="/signin">{t("account.backToSignIn")}</a>
        </p>
      </ConsoleShell>
    </SiteShell>
  );
}
