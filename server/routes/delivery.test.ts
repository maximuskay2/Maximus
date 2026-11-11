import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { StoredDelivery } from "../delivery-settings.ts";
import { createDeliveryRoutes } from "./delivery.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

async function serve(scopes: string[], sync?: (value: StoredDelivery) => Promise<boolean | null>) {
  const folder = mkdtempSync(join(tmpdir(), "maximus-delivery-"));
  folders.push(folder);
  const seen: StoredDelivery[] = [];
  const routes = [createDeliveryRoutes({
    dataDir: folder,
    sync: async (value) => {
      seen.push(value);
      return sync ? sync(value) : null;
    },
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, {
      req, res, url, path: url.pathname, method: req.method ?? "GET",
      auth: { kind: "session", scopes } as never, json, readBody,
    });
    if (!handled) json(res, 404, { error: "missing" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    seen,
    call: async (path: string, init?: RequestInit) => {
      const response = await fetch(`${base}${path}`, init);
      return [response.status, await response.json()] as const;
    },
  };
}

const mail = {
  host: "smtp.example.com",
  port: 587,
  username: "ada",
  password: "s3cret-mail",
  from: "ada@example.com",
  formatModel: "muse-spark-1.3",
  ceilings: { "bot-a": 1 },
};

describe("delivery settings", () => {
  it("saves mailbox details and never returns the password", async () => {
    const { call, seen } = await serve(["admin"], async () => true);
    const saved = await call("/api/admin/delivery", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(mail) });
    expect(saved[0]).toBe(200);
    expect(JSON.stringify(saved[1])).not.toContain("s3cret-mail");
    expect(saved[1]).toMatchObject({ host: "smtp.example.com", passwordSet: true, formatModel: "muse-spark-1.3", synced: true });
    expect(seen[0]?.password).toBe("s3cret-mail");

    const kept = await call("/api/admin/delivery", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...mail, password: "" }),
    });
    expect(kept[0]).toBe(200);
    expect(kept[1]).toMatchObject({ passwordSet: true });
    expect(seen[1]?.password).toBe("s3cret-mail");
    const again = await call("/api/admin/delivery");
    expect(JSON.stringify(again[1])).not.toContain("s3cret-mail");
  });

  it("refuses a member", async () => {
    const { call } = await serve(["member"]);
    const refused = await call("/api/admin/delivery");
    expect(refused[0]).toBe(403);
  });
});
