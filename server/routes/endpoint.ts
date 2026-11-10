// Saved control-plane endpoint: which service (production, local worker, custom URL) this
// install signs in against. Answered before the auth gate — the sign-in screen is exactly where
// a wrong endpoint must be fixable. MAXIMUS_CONTROL_PLANE_URL still beats the saved value.
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  DEFAULT_COMPANION_CONTROL_PLANE_URL,
  LOCAL_CONTROL_PLANE_URL,
  resolveCompanionControlPlaneURL,
} from "../../electron/companion-account-service.mjs";
import { normalizeControlPlaneURL } from "../../electron/control-plane-client.mjs";

type Json = (res: ServerResponse, status: number, body: unknown) => void;
type ReadBody = (req: IncomingMessage, limit?: number) => Promise<unknown>;

export type EndpointSource = "env" | "settings" | "production" | "none";

export interface EndpointDeps {
  env?: NodeJS.ProcessEnv;
  isPackaged?: boolean;
  readSettings: () => string;
  saveSettings: (url: string) => void;
  fetchImpl?: typeof fetch;
}

export function endpointState(deps: Pick<EndpointDeps, "env" | "isPackaged" | "readSettings">): {
  url: string;
  source: EndpointSource;
  managedByEnv: boolean;
  defaultUrl: string;
  localUrl: string;
} {
  const env = deps.env ?? process.env;
  const managedByEnv = Object.hasOwn(env, "MAXIMUS_CONTROL_PLANE_URL");
  const settings = normalizeControlPlaneURL(deps.readSettings());
  const url = resolveCompanionControlPlaneURL({ isPackaged: deps.isPackaged ?? false, environment: env, configuredURL: settings });
  const source: EndpointSource = managedByEnv ? "env" : settings ? "settings" : url ? "production" : "none";
  return { url, source, managedByEnv, defaultUrl: DEFAULT_COMPANION_CONTROL_PLANE_URL, localUrl: LOCAL_CONTROL_PLANE_URL };
}

async function reachable(url: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

export function createEndpointRoute(deps: EndpointDeps): (
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  json: Json,
  readBody: ReadBody,
) => Promise<boolean> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  return async (req, res, path, method, json, readBody): Promise<boolean> => {
    if (path !== "/api/auth/endpoint") return false;
    if (method === "GET") {
      res.setHeader("cache-control", "no-store");
      json(res, 200, endpointState(deps));
      return true;
    }
    if (method !== "POST") return false;
    if (Object.hasOwn(env, "MAXIMUS_CONTROL_PLANE_URL")) {
      json(res, 409, { error: "The service address is set by MAXIMUS_CONTROL_PLANE_URL and cannot be changed here.", code: "endpoint_env_managed" });
      return true;
    }
    const body = (await readBody(req).catch(() => null) ?? {}) as { preset?: unknown; url?: unknown };
    let next: string | null = null;
    if (body.preset === "production") next = "";
    else if (body.preset === "local") next = LOCAL_CONTROL_PLANE_URL;
    else if (typeof body.url === "string") {
      if (body.url.trim() === "") next = "";
      else {
        const normalized = normalizeControlPlaneURL(body.url);
        if (!normalized) {
          json(res, 400, { error: "Use an https address, or http on this computer for a local worker.", code: "endpoint_invalid" });
          return true;
        }
        next = normalized;
      }
    }
    if (next === null) {
      json(res, 400, { error: "Send { preset: production | local } or { url }.", code: "endpoint_invalid" });
      return true;
    }
    if (next && body.preset === undefined && !(await reachable(next, fetchImpl))) {
      json(res, 400, { error: "That address did not answer. Check it and try again.", code: "endpoint_unreachable" });
      return true;
    }
    deps.saveSettings(next);
    res.setHeader("cache-control", "no-store");
    json(res, 200, endpointState(deps));
    return true;
  };
}
