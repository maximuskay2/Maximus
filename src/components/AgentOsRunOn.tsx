import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { api } from "@/state/api";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { AgentOsMachine, AgentOsMachinesPayload } from "../../shared/agent-os.ts";
import type { SidebarMenuItem } from "./SidebarPopoverMenu";
import { Select } from "./Select";

export function useAgentOsRunOn({ botId, threadId }: { botId?: string; threadId?: string }) {
  const [machines, setMachines] = useState<AgentOsMachine[]>([]);
  const [machineId, setMachineId] = useState("self");
  const [error, setError] = useState("");

  useEffect(() => {
    void api<AgentOsMachinesPayload>("/api/agent-os/machines")
      .then((payload) => {
        setMachines(payload.machines);
        return api<{ assignment: { machineId: string } | null }>(`/api/agent-os/assignment?${new URLSearchParams({
          ...(botId ? { botId } : {}),
          ...(threadId ? { threadId } : {}),
        }).toString()}`);
      })
      .then((row) => {
        if (row.assignment?.machineId) setMachineId(row.assignment.machineId);
      })
      .catch(() => {});
  }, [botId, threadId]);

  const choose = useCallback(async (next: string) => {
    setMachineId(next);
    setError("");
    try {
      await api("/api/agent-os/assignment", { method: "PUT", body: JSON.stringify({ machineId: next, botId, threadId }) });
      const picked = machines.find((row) => row.id === next);
      if (picked && !picked.online) return;
      const routed = await api<{ error?: string; machine?: AgentOsMachine }>("/api/agent-os/route", {
        method: "POST",
        body: JSON.stringify({ machineId: next, capability: "computer", botId }),
      });
      if (routed.error) setError(routed.error);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/asleep/i.test(message)) setError(message);
    }
  }, [botId, threadId, machines]);

  return { machines, machineId, error, choose };
}

export function AgentOsWaitNotice({ machines, machineId }: { machines: AgentOsMachine[]; machineId: string }) {
  const machine = machines.find((row) => row.id === machineId);
  if (!machine || machine.online) return null;
  return (
    <p role="status" className="px-2 py-1 text-[12px] leading-4 text-ink-secondary">
      {t("agentOs.waitCard", { name: machine.name })}
    </p>
  );
}

export function agentOsMenuItems(input: {
  machines: AgentOsMachine[];
  machineId: string;
  choose: (id: string) => void;
  check: ReactNode;
}): SidebarMenuItem[] {
  return input.machines.map((machine, index) => ({
    key: `agent-os:${machine.id}`,
    label: machine.name,
    note: machine.online ? t("agentOs.awake") : t("agentOs.asleep"),
    heading: index === 0 ? t("agentOs.runOn") : undefined,
    disabled: false,
    active: input.machineId === machine.id,
    trailing: input.machineId === machine.id ? input.check : undefined,
    onSelect: () => input.choose(machine.id),
  }));
}

export function AgentOsRunOnMenu({ botId, threadId }: { botId?: string; threadId?: string }) {
  const { machines, machineId, error, choose } = useAgentOsRunOn({ botId, threadId });
  if (machines.length === 0) return null;
  return (
    <div className="mt-1 border-t border-hairline/30 pt-1">
      <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t("agentOs.runOn")}</div>
      {machines.map((machine) => (
        <button
          key={machine.id}
          type="button"
          role="menuitemradio"
          aria-checked={machineId === machine.id}
          onClick={() => void choose(machine.id)}
          className={cn(
            "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left",
            machineId === machine.id ? "bg-menu-active" : "hover:bg-menu-hover",
            !machine.online && "opacity-70",
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] leading-[18px] text-ink">{machine.name}</span>
            <span className="block text-[12px] leading-4 text-ink-secondary">{machine.online ? t("agentOs.awake") : t("agentOs.asleep")}</span>
          </span>
          {machineId === machine.id && <Check size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />}
        </button>
      ))}
      <AgentOsWaitNotice machines={machines} machineId={machineId} />
      {error && <p role="alert" className="px-2 pb-1 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

export function AgentOsRunOn({ botId, threadId }: { botId?: string; threadId?: string }) {
  const { machines, machineId, error, choose } = useAgentOsRunOn({ botId, threadId });
  if (machines.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[13px] text-ink-secondary">{t("agentOs.runOn")}</label>
      <Select value={machineId} onChange={(event) => void choose(event.target.value)} aria-label={t("agentOs.runOn")}>
        {machines.map((machine) => (
          <option key={machine.id} value={machine.id}>
            {machine.name}{machine.online ? "" : ` (${t("agentOs.asleep")})`}
          </option>
        ))}
      </Select>
      <AgentOsWaitNotice machines={machines} machineId={machineId} />
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
