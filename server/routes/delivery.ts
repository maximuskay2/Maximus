import { ownerOrAdmin } from "../request-auth.ts";
import {
  applyDeliveryPatch, deliveryView, readDelivery, writeDelivery, type StoredDelivery,
} from "../delivery-settings.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface DeliveryRouteDeps {
  dataDir: string;
  sync?: (value: StoredDelivery) => Promise<boolean | null>;
}

const BODY_LIMIT = 16_384;

async function syncAccounts(value: StoredDelivery): Promise<boolean | null> {
  const base = process.env.MAXIMUS_CONTROL_PLANE_URL?.replace(/\/$/, "");
  const token = process.env.MAXIMUS_OPERATOR_TOKEN;
  if (!base || !token || !value.host) return null;
  try {
    const response = await fetch(`${base}/api/operator/mail`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        host: value.host,
        port: value.port,
        username: value.username,
        password: value.password,
        from: value.from,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function createDeliveryRoutes(deps: DeliveryRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/admin/delivery" || (method !== "GET" && method !== "PUT")) return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only an admin can change delivery." });
    res.setHeader("cache-control", "no-store");
    if (method === "GET") {
      json(res, 200, deliveryView(readDelivery(deps.dataDir)));
      return;
    }
    let body: unknown = null;
    try {
      body = await readBody(req, BODY_LIMIT);
    } catch {
      return json(res, 400, { error: "Could not read delivery details." });
    }
    const applied = applyDeliveryPatch(readDelivery(deps.dataDir), body);
    if (!applied.ok) return json(res, 400, { error: applied.error });
    writeDelivery(deps.dataDir, applied.value);
    const synced = await (deps.sync ?? syncAccounts)(applied.value);
    json(res, 200, deliveryView(applied.value, synced));
  };
}
