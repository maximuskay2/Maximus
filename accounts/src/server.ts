import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Pool } from "pg";

import { readProcessConfig } from "./config.ts";
import { createDatabase, createPool } from "./db.ts";
import { smtpSender } from "./smtp.ts";
import { migrate } from "./migrate.ts";
import { handleRequest } from "./router.ts";
import type { AccountsEnv, JobContext } from "./types.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function stringVars(vars: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function buildEnv(pool: Pool, vars: NodeJS.ProcessEnv, smtpURL: string | null): AccountsEnv {
  return {
    ...stringVars(vars),
    RELAY_DISABLED: vars.RELAY_DISABLED ?? "1",
    DB: createDatabase(pool),
    EMAIL: smtpURL
      ? smtpSender(smtpURL)
      : {
        send: async () => {
          throw new Error("SMTP_URL is not set");
        },
      },
    BETTER_AUTH_SECRET: vars.BETTER_AUTH_SECRET ?? "",
  };
}

function clientAddress(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const chain = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  const last = chain?.split(",").pop()?.trim();
  if (last) return last;
  return request.socket.remoteAddress ?? "unknown";
}

function toWebRequest(request: IncomingMessage, port: number): Request {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined || key === "cf-connecting-ip") continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
    } else {
      headers.set(key, value);
    }
  }
  headers.set("cf-connecting-ip", clientAddress(request));
  const init: RequestInit & { duplex?: string } = { method: request.method ?? "GET", headers };
  if (request.method !== undefined && !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
    init.body = Readable.toWeb(request);
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function sendWebResponse(response: Response, res: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, headers);
  res.end(body);
}

export async function start(vars: NodeJS.ProcessEnv = process.env): Promise<{ port: number; close: () => Promise<void> }> {
  const config = readProcessConfig(stringVars(vars));
  const pool = createPool(config.databaseURL);
  const applied = await migrate(pool, MIGRATIONS_DIR);
  if (applied.length > 0) console.log(JSON.stringify({ message: "accounts migrations applied", migrations: applied }));
  const env = buildEnv(pool, vars, config.smtpURL);
  const ctx: JobContext = {
    waitUntil: (promise) => {
      promise.catch((error) => {
        console.error(JSON.stringify({ message: "background task failed", error: error instanceof Error ? error.message : "unknown" }));
      });
    },
  };
  const server = createServer((request, res) => {
    handleRequest(toWebRequest(request, config.port), {
      env,
      ctx,
      config,
      pool,
      requestId: "",
      cronSecret: config.cronSecret,
    }).then(
      (response) => sendWebResponse(response, res),
      (error) => {
        console.error(JSON.stringify({ message: "request failed", error: error instanceof Error ? error.message : "unknown" }));
        res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: "internal_error" }));
      },
    );
  });
  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  console.log(JSON.stringify({ message: "accounts listening", port: config.port }));
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await pool.end();
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      void close().finally(() => process.exit(0));
    });
  }
  return { port: config.port, close };
}

const invoked = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) {
  start().catch((error) => {
    console.error(JSON.stringify({ message: "accounts failed to start", error: error instanceof Error ? error.message : "unknown" }));
    process.exit(1);
  });
}
