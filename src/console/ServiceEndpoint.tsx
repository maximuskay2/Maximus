import { useEffect, useState } from "react";

import { t } from "../lib/i18n";

export interface EndpointInfo {
  url: string;
  source: "env" | "settings" | "production" | "none";
  managedByEnv: boolean;
  defaultUrl: string;
  localUrl: string;
}

export function ServiceEndpointView({ info, custom, busy, error, onCustom, onSave }: {
  info: EndpointInfo;
  custom: string;
  busy: boolean;
  error: string | null;
  onCustom: (value: string) => void;
  onSave: (body: { preset: "production" | "local" } | { url: string }) => void;
}) {
  return (
    <div>
      <p>
        {t("console.endpoint.current")}{" "}
        <span className="font-mono text-[12px]">{info.url || info.defaultUrl}</span>
        {info.managedByEnv ? <span> · {t("console.endpoint.envManaged")}</span> : null}
      </p>
      {info.managedByEnv ? null : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => onSave({ preset: "production" })} className="rounded-md border border-current px-3 py-1 opacity-80 hover:opacity-100 disabled:opacity-50">
            {t("console.endpoint.production")}
          </button>
          <button type="button" disabled={busy} onClick={() => onSave({ preset: "local" })} className="rounded-md border border-current px-3 py-1 opacity-80 hover:opacity-100 disabled:opacity-50">
            {t("console.endpoint.local")}
          </button>
          <input
            value={custom}
            onChange={(e) => onCustom(e.target.value)}
            placeholder={info.localUrl}
            spellCheck={false}
            aria-label={t("console.endpoint.customLabel")}
            className="min-w-[220px] flex-1 rounded-md border border-current bg-transparent px-3 py-1 font-mono text-[12px] opacity-90"
          />
          <button type="button" disabled={busy || !custom.trim()} onClick={() => onSave({ url: custom.trim() })} className="rounded-md border border-current px-3 py-1 opacity-80 hover:opacity-100 disabled:opacity-50">
            {t("console.endpoint.save")}
          </button>
        </div>
      )}
      {error ? <p className="mt-2 text-danger">{error}</p> : null}
    </div>
  );
}

export function ServiceEndpointPicker({ onSaved }: { onSaved?: () => void }) {
  const [info, setInfo] = useState<EndpointInfo | null>(null);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/auth/endpoint")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (active && body && typeof body.url === "string") setInfo(body as EndpointInfo); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (!info) return null;
  const save = async (body: { preset: "production" | "local" } | { url: string }): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/endpoint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const next = (await res.json().catch(() => null)) as (EndpointInfo & { error?: string }) | null;
      if (!res.ok || !next || typeof next.url !== "string") {
        setError(typeof next?.error === "string" ? next.error : t("console.endpoint.failed"));
        return;
      }
      setInfo(next);
      setCustom("");
      onSaved?.();
    } catch {
      setError(t("console.endpoint.failed"));
    } finally {
      setBusy(false);
    }
  };
  return <ServiceEndpointView info={info} custom={custom} busy={busy} error={error} onCustom={setCustom} onSave={(body) => void save(body)} />;
}
