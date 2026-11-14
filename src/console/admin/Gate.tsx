import { useState } from "react";

import { t } from "../../lib/i18n";
import { defaultDeviceLabel, signInWithPassword } from "../../lib/session";
import { normalizeConsoleEmail, validConsoleEmail } from "../account";
import { adminSessionOpen, harnessSession } from "../harness";
import { ConsoleError as ErrorBox, fieldInput, fieldLabel, primaryButton } from "../shell";

export function AdminPasswordGate({ onOpen }: { onOpen: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid min-h-screen place-items-center bg-app px-4 text-ink">
      <form
        className="w-full max-w-[380px]"
        onSubmit={(event) => {
          event.preventDefault();
          const normalized = normalizeConsoleEmail(email);
          if (!validConsoleEmail(normalized)) {
            setError(t("console.invalidEmail"));
            return;
          }
          if (password.length < 8) {
            setError(t("account.passwordShort"));
            return;
          }
          setBusy(true);
          setError(null);
          void signInWithPassword({ email: normalized, password, label: defaultDeviceLabel() }).then(async (result) => {
            if (!result.ok) {
              setBusy(false);
              setError(result.error);
              return;
            }
            const session = await harnessSession();
            if (!adminSessionOpen(session)) {
              await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
              setBusy(false);
              setPassword("");
              setError(t("console.admin.gateDenied"));
              return;
            }
            onOpen(session.email);
          });
        }}
      >
        <h1 className="text-[22px] font-semibold">{t("console.admin.gateTitle")}</h1>
        <p className="mt-2 text-[14px] text-ink-secondary">{t("console.admin.gateSubtitle")}</p>
        <label className={fieldLabel} htmlFor="admin-gate-email">{t("console.email")}</label>
        <input
          id="admin-gate-email"
          className={fieldInput}
          type="email"
          autoComplete="username"
          value={email}
          disabled={busy}
          onChange={(event) => {
            setEmail(event.target.value);
            setError(null);
          }}
        />
        <label className={fieldLabel} htmlFor="admin-gate-password">{t("account.password")}</label>
        <input
          id="admin-gate-password"
          className={fieldInput}
          type="password"
          autoComplete="current-password"
          value={password}
          disabled={busy}
          onChange={(event) => {
            setPassword(event.target.value);
            setError(null);
          }}
        />
        <button type="submit" className={primaryButton} disabled={busy}>
          {busy ? t("pair.signingIn") : t("accounts.signIn")}
        </button>
        <ErrorBox message={error} />
        <p className="mt-5 text-center text-[12px] text-ink-faint">
          <a href="/forgot">{t("account.forgotLink")}</a>
        </p>
      </form>
    </div>
  );
}
