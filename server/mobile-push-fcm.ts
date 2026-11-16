import { createSign } from "node:crypto";

/** FCM HTTP v1 sender. Google's OAuth2 + FCM endpoints are the only network;
 * `fetchImpl` and `clock` are injectable so tests never touch either. */

export interface FcmCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface FcmMessage {
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
  /** APNs collapse id / Android collapse key: one banner per thread. */
  collapseKey: string;
  highPriority: boolean;
  /** validate_only: checks the token without delivering. */
  dryRun?: boolean;
}

export type FcmSendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string; deadToken: boolean };

export interface FcmSender {
  send(message: FcmMessage): Promise<FcmSendResult>;
  close(): void;
}

interface Deps {
  credentials: FcmCredentials;
  fetchImpl?: typeof fetch;
  clock?: () => number;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

const base64Url = (input: string | Buffer): string =>
  Buffer.from(input).toString("base64url");

function signJwt(credentials: FcmCredentials, nowMs: number): string {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify({
    iss: credentials.clientEmail,
    sub: credentials.clientEmail,
    aud: TOKEN_URL,
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor(nowMs / 1000) + 3600,
    scope: FCM_SCOPE,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${body}`);
  signer.end();
  return `${header}.${body}.${signer.sign(credentials.privateKey, "base64url")}`;
}

/** Token responses the FCM API documents as "this registration is gone". */
const DEAD_TOKEN_ERRORS = new Set([
  "UNREGISTERED",
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "SENDER_ID_MISMATCH",
]);

export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): FcmCredentials | null {
  const projectId = env.MAXIMUS_FCM_PROJECT_ID?.trim();
  const clientEmail = env.MAXIMUS_FCM_CLIENT_EMAIL?.trim();
  const privateKey = env.MAXIMUS_FCM_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

export function createFcmSender(deps: Deps): FcmSender {
  const { credentials } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const clock = deps.clock ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  async function accessToken(): Promise<string> {
    const now = clock();
    if (cached && cached.expiresAt - 60_000 > now) return cached.token;
    inflight ??= (async () => {
      const assertion = signJwt(credentials, clock());
      const res = await fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }).toString(),
      });
      const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
      if (!res.ok || typeof json.access_token !== "string") {
        throw new Error(`FCM OAuth failed (${res.status})`);
      }
      const ttlMs = typeof json.expires_in === "number" ? json.expires_in * 1000 : 3_600_000;
      cached = { token: json.access_token, expiresAt: clock() + ttlMs };
      return cached.token;
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  return {
    async send(message: FcmMessage): Promise<FcmSendResult> {
      let token: string;
      try {
        token = await accessToken();
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "FCM OAuth failed", deadToken: false };
      }
      const url = `https://fcm.googleapis.com/v1/projects/${credentials.projectId}/messages:send`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          validate_only: message.dryRun === true,
          message: {
            token: message.token,
            notification: { title: message.title, body: message.body },
            data: message.data,
            android: {
              priority: message.highPriority ? "HIGH" : "NORMAL",
              collapse_key: message.collapseKey,
            },
            webpush: {
              headers: {
                Urgency: message.highPriority ? "high" : "normal",
                TTL: "86400",
              },
              notification: {
                title: message.title,
                body: message.body,
                icon: "/app-icon-192.png",
                tag: message.collapseKey,
              },
              data: message.data,
            },
            apns: {
              headers: {
                "apns-priority": message.highPriority ? "10" : "5",
                "apns-collapse-id": message.collapseKey,
              },
              payload: {
                aps: {
                  sound: "default",
                  "content-available": 1,
                },
              },
            },
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { name?: unknown; error?: { status?: unknown; message?: unknown } };
      if (res.ok) return { ok: true, messageId: typeof json.name === "string" ? json.name : "" };
      const status = typeof json.error?.status === "string" ? json.error.status : "";
      const detail = typeof json.error?.message === "string" ? json.error.message : `FCM send failed (${res.status})`;
      return { ok: false, error: detail, deadToken: DEAD_TOKEN_ERRORS.has(status) };
    },
    close() {
      cached = null;
    },
  };
}
