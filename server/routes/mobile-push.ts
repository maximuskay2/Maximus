import { isFcmPlatform } from "../../shared/fcm.ts";
import { ownerOrAdmin, type RequestAuth } from "../request-auth.ts";
import type { FcmSender } from "../mobile-push-fcm.ts";
import type { PushTokenRow } from "../message-db.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PushRouteDeps {
  upsertToken(row: {
    token: string;
    platform: string;
    deviceName?: string | null;
    personKey?: string | null;
    appVersion?: string | null;
  }): void;
  removeToken(token: string): boolean;
  listTokens(): PushTokenRow[];
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  sender(): FcmSender | null;
  /** The caller's stable person key for forPerson-scoped delivery. */
  actorKey(auth: RequestAuth & { kind: "session" }): string;
}

export const PUSH_ENABLED_KEY = "push.enabled";

const MAX_TOKEN = 4096;
const MAX_NAME = 120;

const publicToken = (row: PushTokenRow) => ({
  platform: row.platform,
  deviceName: row.deviceName,
  appVersion: row.appVersion,
  lastSeenAt: row.lastSeenAt,
  // The raw token never leaves the server again: enough to tell phones apart.
  fingerprint: row.token.slice(-8),
});

/** Mobile push registration + settings, served by the paired server itself
 * (the /v1/installations path matches the phone's control-plane-shaped
 * client; nothing here calls out to a control plane). Register/unregister
 * take any paired session; reads, settings and test sends are admin-only. */
export function createMobilePushRoutes(deps: PushRouteDeps): RouteHandler {
  const enabled = (): boolean => deps.getSetting(PUSH_ENABLED_KEY) !== "0";
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method === "GET" && path === "/v1/installations/self/push") {
      if (!ownerOrAdmin(auth)) return json(res, 403, { error: "admin only" });
      return json(res, 200, {
        enabled: enabled(),
        configured: deps.sender() !== null,
        devices: deps.listTokens().map(publicToken),
      });
    }
    if (method === "POST" && path === "/v1/installations/self/push/register") {
      if (auth.kind !== "session" && auth.kind !== "loopback") {
        return json(res, 401, { error: "pair this phone first" });
      }
      const body = await readBody(req);
      const token = typeof body?.token === "string" ? body.token.trim() : "";
      if (!token || token.length > MAX_TOKEN) {
        return json(res, 400, { error: "token must be a non-empty string" });
      }
      if (!isFcmPlatform(body?.platform)) {
        return json(res, 400, { error: "platform must be ios, android, web or desktop" });
      }
      const deviceName = typeof body?.deviceName === "string" ? body.deviceName.trim().slice(0, MAX_NAME) : null;
      const appVersion = typeof body?.appVersion === "string" ? body.appVersion.trim().slice(0, MAX_NAME) : null;
      deps.upsertToken({
        token,
        platform: body.platform,
        deviceName: deviceName || null,
        personKey: auth.kind === "session" ? deps.actorKey(auth) : null,
        appVersion: appVersion || null,
      });
      return json(res, 200, { ok: true, enabled: enabled() });
    }
    if (method === "DELETE" && path === "/v1/installations/self/push/register") {
      const body = await readBody(req).catch(() => null);
      const token = typeof body?.token === "string" ? body.token : "";
      if (!token) return json(res, 400, { error: "token is required" });
      return json(res, 200, { ok: true, removed: deps.removeToken(token) });
    }
    if (method === "PATCH" && path === "/v1/installations/self/push/settings") {
      if (!ownerOrAdmin(auth)) return json(res, 403, { error: "admin only" });
      const body = await readBody(req);
      if (typeof body?.enabled !== "boolean") {
        return json(res, 400, { error: "enabled must be a boolean" });
      }
      deps.setSetting(PUSH_ENABLED_KEY, body.enabled ? "1" : "0");
      return json(res, 200, { ok: true, enabled: body.enabled });
    }
    if (method === "POST" && path === "/v1/installations/self/push/test") {
      if (!ownerOrAdmin(auth)) return json(res, 403, { error: "admin only" });
      const sender = deps.sender();
      if (!sender) return json(res, 503, { error: "push is not configured (FCM credentials missing)" });
      const body = await readBody(req);
      const token = typeof body?.token === "string" && body.token
        ? body.token
        : deps.listTokens()[0]?.token;
      if (!token) return json(res, 404, { error: "no registered devices" });
      const result = await sender.send({
        token,
        title: "Maximus",
        body: "Push is working — this is a test.",
        data: { kind: "notice", threadId: "", botId: "", notificationId: "test" },
        collapseKey: "maximus-test",
        highPriority: false,
        dryRun: body?.dryRun === true,
      });
      if (!result.ok && result.deadToken) deps.removeToken(token);
      return result.ok
        ? json(res, 200, { ok: true, dryRun: body?.dryRun === true })
        : json(res, 502, { error: result.error });
    }
    return PASS;
  };
}
