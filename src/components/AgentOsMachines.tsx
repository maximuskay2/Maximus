import { useCallback, useEffect, useState } from "react";
import { api } from "@/state/api";
import { t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { AGENT_OS_CAPABILITIES, type AgentOsAuditRow, type AgentOsMachinesPayload, type AgentOsPlugin, type AgentOsPolicy } from "../../shared/agent-os.ts";
import { Card } from "./SettingsPrimitives";

const KIND_LABEL: Record<string, string> = {
  this_desktop: "This computer",
  cloud_home: "Cloud home",
  lent_peer: "Shared computer",
  team_boat: "Team computer",
};

export function AgentOsMachines() {
  const admin = useOwnerOrAdmin();
  const [payload, setPayload] = useState<AgentOsMachinesPayload | null>(null);
  const [plugins, setPlugins] = useState<AgentOsPlugin[]>([]);
  const [audit, setAudit] = useState<AgentOsAuditRow[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [policy, setPolicy] = useState<AgentOsPolicy | null>(null);
  const load = useCallback(() => {
    void api<AgentOsMachinesPayload>("/api/agent-os/machines")
      .then(setPayload)
      .catch((err: Error) => setError(err.message));
    void api<{ plugins: AgentOsPlugin[] }>("/api/agent-os/plugins")
      .then((row) => setPlugins(row.plugins ?? []))
      .catch(() => {});
    if (admin === true) {
      void api<{ rows: AgentOsAuditRow[] }>("/api/agent-os/audit")
        .then((row) => setAudit(row.rows ?? []))
        .catch(() => {});
      void api<AgentOsPolicy>("/api/agent-os/policy")
        .then(setPolicy)
        .catch(() => {});
    }
  }, [admin]);
  useEffect(() => { load(); }, [load]);

  const run = async (plugin: AgentOsPlugin, action: string, confirm = false) => {
    setNotice("");
    setError("");
    try {
      const result = await api<{ preview?: string; as?: string }>("/api/agent-os/plugins/invoke", {
        method: "POST",
        body: JSON.stringify({ mode: plugin.mode, app: plugin.app, action, confirm }),
      });
      setNotice(result.preview ? `${result.preview} as ${result.as ?? "you"}` : t("agentOs.pluginOk"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/\bconfirm\b/i.test(message)) {
        if (window.confirm(t("agentOs.confirmWrite", { app: plugin.app, action }))) {
          await run(plugin, action, true);
          return;
        }
      }
      setError(message);
    }
  };

  return (
    <Card title={t("agentOs.title")} subtitle={t("agentOs.subtitle")}>
      {error && <p role="alert" className="mb-2 text-[12px] text-danger">{error}</p>}
      {notice && <p className="mb-2 text-[12px] text-ink-secondary">{notice}</p>}
      <ul className="divide-y divide-hairline/40">
        {(payload?.machines ?? []).map((machine) => (
          <li key={machine.id} className={`flex items-center justify-between gap-3 py-2 text-[13px] ${machine.online ? "text-ink" : "text-ink-tertiary"}`}>
            <span>
              <span className="font-medium">{machine.name}</span>
              <span className="ml-2 text-[12px] text-ink-secondary">{KIND_LABEL[machine.kind] ?? machine.kind}</span>
            </span>
            <span>{machine.online ? t("agentOs.awake") : t("agentOs.asleep")}</span>
          </li>
        ))}
      </ul>
      {!payload?.multiMachine && <p className="mt-3 text-[12px] leading-relaxed text-ink-secondary">{t("agentOs.ossLimit")}</p>}
      {admin === true && policy && (
        <div className="mt-4">
          <div className="text-[13px] font-medium text-ink">{t("agentOs.policy")}</div>
          <p className="mt-1 text-[12px] text-ink-secondary">{t("agentOs.policyHint")}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-[12px]">
            {AGENT_OS_CAPABILITIES.map((capability) => (
              <label key={capability} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={policy.capabilities.includes(capability)}
                  onChange={() => {
                    const capabilities = policy.capabilities.includes(capability)
                      ? policy.capabilities.filter((item) => item !== capability)
                      : [...policy.capabilities, capability];
                    const next = { ...policy, capabilities };
                    setPolicy(next);
                    void api("/api/agent-os/policy", { method: "PUT", body: JSON.stringify(next) }).catch((err: Error) => setError(err.message));
                  }}
                />
                {t(`agentOs.capability.${capability}` as "agentOs.capability.computer")}
              </label>
            ))}
          </div>
          {(payload?.machines.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap gap-3 text-[12px]">
              {(payload?.machines ?? []).map((machine) => (
                <label key={machine.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={policy.machines.length === 0 || policy.machines.includes(machine.id)}
                    onChange={() => {
                      const selected = policy.machines.length === 0 ? (payload?.machines ?? []).map((row) => row.id) : policy.machines;
                      const machines = selected.includes(machine.id) ? selected.filter((id) => id !== machine.id) : [...selected, machine.id];
                      const next = { ...policy, machines: machines.length === (payload?.machines.length ?? 0) ? [] : machines };
                      setPolicy(next);
                      void api("/api/agent-os/policy", { method: "PUT", body: JSON.stringify(next) }).catch((err: Error) => setError(err.message));
                    }}
                  />
                  {machine.name}
                </label>
              ))}
            </div>
          )}
          <label className="mt-2 flex flex-col gap-1 text-[12px] text-ink-secondary">
            {t("agentOs.policyBots")}
            <input
              value={policy.bots.join(", ")}
              onChange={(event) => {
                const bots = event.target.value.split(",").map((id) => id.trim()).filter(Boolean);
                const next = { ...policy, bots };
                setPolicy(next);
                void api("/api/agent-os/policy", { method: "PUT", body: JSON.stringify(next) }).catch((err: Error) => setError(err.message));
              }}
              className="rounded-md border border-hairline/40 bg-inset px-2 py-1 text-ink"
            />
          </label>
        </div>
      )}
      {admin === true && audit.length > 0 && (
        <div className="mt-4">
          <div className="text-[13px] font-medium text-ink">{t("agentOs.audit")}</div>
          <ul className="mt-1 max-h-40 overflow-auto text-[12px] text-ink-secondary">
            {audit.slice().reverse().map((row, index) => (
              <li key={`${row.at}-${index}`}>
                {new Date(row.at).toLocaleString()} · {row.actor} · {row.machineId ?? "—"} · {row.tool} · {row.outcome}
              </li>
            ))}
          </ul>
        </div>
      )}
      {plugins.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <div className="text-[13px] font-medium text-ink">{t("agentOs.plugins")}</div>
          {plugins.map((plugin) => (
            <div key={`${plugin.mode}-${plugin.app}`} className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="capitalize text-ink-secondary">{plugin.mode} · {plugin.app}</span>
              {plugin.actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  className="rounded-full bg-ink/5 px-2 py-1 text-ink hover:bg-ink/10"
                  onClick={() => void run(plugin, action)}
                >
                  {action}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
