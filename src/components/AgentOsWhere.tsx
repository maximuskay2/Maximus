import { useEffect, useState } from "react";
import { api } from "@/state/api";
import { t } from "@/lib/i18n";
import type { CardAnswerer } from "../../shared/wire.ts";
import type { AgentOsMachinesPayload } from "../../shared/agent-os.ts";

function whoName(answeredBy?: CardAnswerer): string {
  if (!answeredBy) return "";
  if (answeredBy.kind === "session" || answeredBy.kind === "bot") return answeredBy.name;
  if (answeredBy.kind === "loopback") return t("activity.actor.loopback");
  return "";
}

export function AgentOsWhere({
  botId,
  threadId,
  answeredBy,
}: {
  botId?: string;
  threadId?: string;
  answeredBy?: CardAnswerer;
}) {
  const [machine, setMachine] = useState("");
  useEffect(() => {
    const params = new URLSearchParams({
      ...(botId ? { botId } : {}),
      ...(threadId ? { threadId } : {}),
    });
    void api<{ assignment: { machineId: string } | null }>(`/api/agent-os/assignment?${params.toString()}`)
      .then(async (row) => {
        if (!row.assignment?.machineId) return;
        const payload = await api<AgentOsMachinesPayload>("/api/agent-os/machines");
        const found = payload.machines.find((item) => item.id === row.assignment!.machineId);
        if (found) setMachine(found.name);
      })
      .catch(() => {});
  }, [botId, threadId]);
  const who = whoName(answeredBy);
  if (!machine && !who) return null;
  return (
    <span>
      {machine ? ` · ${t("agentOs.onMachine", { name: machine })}` : ""}
      {who ? ` · ${t("agentOs.approvedBy", { name: who })}` : ""}
    </span>
  );
}
