import { useEffect, useState, type FormEvent } from "react";

import { t } from "@/lib/i18n";
import { defaultDeviceLabel, signInWithPassword, signUpWithPassword } from "@/lib/session";

const OAUTH_IDS = new Set(["google", "github", "apple", "microsoft"]);

export function AccountForm({
  mode,
  inputClass,
  buttonClass,
  quietClass,
  onSignedIn,
}: {
  mode: "signin" | "signup";
  inputClass: string;
  buttonClass: string;
  quietClass: string;
  onSignedIn: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    void fetch("/api/auth/methods")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { methods?: { id?: unknown; label?: unknown }[] } | null) => {
        const methods = Array.isArray(body?.methods) ? body.methods.flatMap((method) => (
          typeof method.id === "string" && typeof method.label === "string" && OAUTH_IDS.has(method.id) ? [{ id: method.id, label: method.label }] : []
        )) : [];
        setProviders(methods);
      })
      .catch(() => setProviders([]));
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.includes("@")) {
      setError(t("serverError.email.invalid"));
      return;
    }
    if (password.length < 8) {
      setError(t("account.passwordShort"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = mode === "signup"
      ? await signUpWithPassword({ email, password, label: defaultDeviceLabel() })
      : await signInWithPassword({ email, password, label: defaultDeviceLabel() });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSignedIn();
  }
  return (
    <form onSubmit={submit}>
      <label className="mt-4 block text-[12px] font-medium text-ink-secondary" htmlFor="account-email">{t("console.email")}</label>
      <input id="account-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} spellCheck={false} className={inputClass} />
      <label className="mt-4 block text-[12px] font-medium text-ink-secondary" htmlFor="account-password">{t("account.password")}</label>
      <input id="account-password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} />
      {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
      <button type="submit" disabled={busy || !email.includes("@") || password.length < 8} className={buttonClass}>
        {t(busy ? (mode === "signup" ? "console.signup.creating" : "pair.signingIn") : mode === "signup" ? "account.create" : "accounts.signIn")}
      </button>
      {providers.map((method) => (
        <a key={method.id} href={`/api/auth/oauth/${method.id}/start`} className={quietClass}>
          {t("pair.continueWith", { provider: method.label })}
        </a>
      ))}
      <p className="mt-4 text-center text-[13px]">
        {mode === "signup"
          ? <a href="/signin" className="text-ink-secondary underline">{t("account.switchToSignIn")}</a>
          : <a href="/signup" className="text-ink-secondary underline">{t("account.switchToSignUp")}</a>}
      </p>
    </form>
  );
}
