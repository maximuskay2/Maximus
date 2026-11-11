import { z } from "zod";

import { HTTPError } from "./http.ts";
import { contractJSON } from "./contract.ts";
import type { AccountsEnv } from "./types.ts";

export interface OperatorMail {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
}

const hostSchema = z.string().trim().min(1).max(253).refine((host) => !/[\s/@:]/.test(host));
const mailSchema = z.object({
  host: hostSchema,
  port: z.number().int().min(1).max(65535),
  username: z.string().max(200).default(""),
  password: z.string().max(500).optional(),
  from: z.string().trim().max(200).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
});

interface MailRow {
  host: string;
  port: number;
  username: string;
  password: string;
  from_email: string;
  password_set?: boolean;
}

function operatorToken(env: AccountsEnv): string {
  const token = env.MAXIMUS_OPERATOR_TOKEN;
  if (typeof token !== "string" || !token) throw new HTTPError(503, "operator_unavailable");
  return token;
}

function requireOperator(request: Request, env: AccountsEnv): void {
  const expected = operatorToken(env);
  const presented = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!presented) throw new HTTPError(401, "unauthorized");
  if (presented !== expected) throw new HTTPError(403, "forbidden");
}

export function smtpUrl(mail: Pick<OperatorMail, "host" | "port" | "username" | "password">): string {
  const auth = mail.username
    ? `${encodeURIComponent(mail.username)}:${encodeURIComponent(mail.password)}@`
    : "";
  return `smtp://${auth}${mail.host}:${mail.port}`;
}

export async function readOperatorMail(env: Pick<AccountsEnv, "DB">): Promise<OperatorMail | null> {
  try {
    const row = await env.DB.prepare(
      "SELECT host, port, username, password, from_email FROM operator_mail WHERE id = 1",
    ).first<MailRow>();
    if (!row) return null;
    return { host: row.host, port: Number(row.port), username: row.username, password: row.password, from: row.from_email };
  } catch (error) {
    if (error instanceof Error && /operator_mail/.test(error.message) && /does not exist/.test(error.message)) return null;
    throw error;
  }
}

export async function getOperatorMail(request: Request, env: AccountsEnv): Promise<Response> {
  requireOperator(request, env);
  const row = await env.DB.prepare(
    "SELECT host, port, username, from_email, (password <> '') AS password_set FROM operator_mail WHERE id = 1",
  ).first<MailRow>();
  if (!row) return contractJSON({ host: "", port: 587, username: "", from: "", passwordSet: false });
  return contractJSON({
    host: row.host,
    port: Number(row.port),
    username: row.username,
    from: row.from_email,
    passwordSet: row.password_set === true,
  });
}

export async function putOperatorMail(request: Request, env: AccountsEnv): Promise<Response> {
  requireOperator(request, env);
  const parsed = mailSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  const mail = parsed.data;
  await env.DB.prepare(
    `INSERT INTO operator_mail (id, host, port, username, password, from_email, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, now())
     ON CONFLICT (id) DO UPDATE SET
       host = excluded.host,
       port = excluded.port,
       username = excluded.username,
       password = CASE WHEN excluded.password = '' THEN operator_mail.password ELSE excluded.password END,
       from_email = excluded.from_email,
       updated_at = now()`,
  ).bind(mail.host, mail.port, mail.username, mail.password ?? "", mail.from).run();
  return getOperatorMail(request, env);
}

export async function currentSmtpUrl(db: AccountsEnv["DB"], fallback: string | null): Promise<string | null> {
  const saved = await readOperatorMail({ DB: db });
  return saved ? smtpUrl(saved) : fallback;
}
