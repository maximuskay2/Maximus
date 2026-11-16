import { readFileSync } from "node:fs";
import { join } from "node:path";

import { apiBase, projectHeaders } from "./composio-project.ts";

export interface PersonConnectorAccount {
  connected: boolean;
  account?: string;
  items?: Array<{ id: string; status?: string; alias?: string }>;
}

export async function listPersonConnector(
  dataDir: string,
  slug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PersonConnectorAccount> {
  let apiKey = "";
  let userId = "";
  try {
    const cfg = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")) as {
      composio?: { apiKey?: string; userId?: string };
    };
    apiKey = cfg.composio?.apiKey?.trim() ?? "";
    userId = cfg.composio?.userId?.trim() ?? "";
  } catch {
    return { connected: false };
  }
  if (!apiKey || !userId) return { connected: false };
  const params = new URLSearchParams({
    limit: "50",
    user_ids: userId,
    toolkit_slugs: slug,
    order_by: "updated_at",
    order_direction: "desc",
  });
  const response = await fetchImpl(`${apiBase()}/connected_accounts?${params}`, {
    headers: projectHeaders(apiKey),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return { connected: false };
  const body = (await response.json()) as { items?: Array<{ id?: string; status?: string; alias?: string | null }> };
  const items = (body.items ?? [])
    .filter((row): row is { id: string; status?: string; alias?: string | null } => Boolean(row.id))
    .map((row) => ({ id: row.id, status: row.status, ...(row.alias ? { alias: row.alias } : {}) }));
  return {
    connected: items.length > 0,
    account: items[0]?.alias || userId,
    items,
  };
}

function composioIdentity(dataDir: string): { apiKey: string; userId: string } | null {
  try {
    const cfg = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")) as {
      composio?: { apiKey?: string; userId?: string };
    };
    const apiKey = cfg.composio?.apiKey?.trim() ?? "";
    const userId = cfg.composio?.userId?.trim() ?? "";
    return apiKey && userId ? { apiKey, userId } : null;
  } catch {
    return null;
  }
}

export async function executePersonConnector(
  dataDir: string,
  input: { slug: string; tool: string; arguments: Record<string, string> },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; detail?: string }> {
  const identity = composioIdentity(dataDir);
  if (!identity) return { ok: false, detail: "Connect that app as yourself in Apps." };
  const listed = await listPersonConnector(dataDir, input.slug, fetchImpl);
  const accountId = listed.items?.[0]?.id;
  const response = await fetchImpl(`${apiBase()}/tools/execute`, {
    method: "POST",
    headers: projectHeaders(identity.apiKey, true),
    body: JSON.stringify({
      tool_slug: input.tool,
      arguments: input.arguments,
      user_id: identity.userId,
      ...(accountId ? { connected_account_id: accountId } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return { ok: false, detail: `Could not call ${input.tool} as ${identity.userId}.` };
  return { ok: true, detail: `Called ${input.tool} as ${listed.account ?? identity.userId}.` };
}
