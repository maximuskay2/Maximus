// Sign-in with a provider the operator has registered. A client id and secret
// pair turns a provider on; neither value is returned to a browser.
// Google, GitHub, Apple and Microsoft each confirm the address over their
// own token endpoint. Apple puts the address only in the id_token.

import { normalizeAccountEmail } from "../electron/control-plane-client.mjs";

export const OAUTH_PROVIDER_IDS = ["google", "github", "apple", "microsoft"] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

const PROVIDERS: { id: OAuthProviderId; label: string; idEnv: string; secretEnv: string }[] = [
  { id: "google", label: "Google", idEnv: "MAXIMUS_OAUTH_GOOGLE_CLIENT_ID", secretEnv: "MAXIMUS_OAUTH_GOOGLE_CLIENT_SECRET" },
  { id: "github", label: "GitHub", idEnv: "MAXIMUS_OAUTH_GITHUB_CLIENT_ID", secretEnv: "MAXIMUS_OAUTH_GITHUB_CLIENT_SECRET" },
  { id: "apple", label: "Apple", idEnv: "MAXIMUS_OAUTH_APPLE_CLIENT_ID", secretEnv: "MAXIMUS_OAUTH_APPLE_CLIENT_SECRET" },
  { id: "microsoft", label: "Microsoft", idEnv: "MAXIMUS_OAUTH_MICROSOFT_CLIENT_ID", secretEnv: "MAXIMUS_OAUTH_MICROSOFT_CLIENT_SECRET" },
];

export function isOAuthProvider(value: string): value is OAuthProviderId {
  return (OAUTH_PROVIDER_IDS as readonly string[]).includes(value);
}

export function configuredOAuthProviders(env: NodeJS.ProcessEnv): { id: OAuthProviderId; label: string }[] {
  return PROVIDERS.flatMap((provider) => {
    const clientId = env[provider.idEnv]?.trim();
    const clientSecret = env[provider.secretEnv]?.trim();
    return clientId && clientSecret ? [{ id: provider.id, label: provider.label }] : [];
  });
}

function credentials(env: NodeJS.ProcessEnv, id: OAuthProviderId): { clientId: string; clientSecret: string } | null {
  const provider = PROVIDERS.find((one) => one.id === id);
  if (!provider) return null;
  const clientId = env[provider.idEnv]?.trim() ?? "";
  const clientSecret = env[provider.secretEnv]?.trim() ?? "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function oauthAuthorizeUrl(id: OAuthProviderId, input: { clientId: string; redirectUri: string; state: string }): string {
  const common = { client_id: input.clientId, redirect_uri: input.redirectUri, response_type: "code", state: input.state };
  if (id === "google") {
    return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ ...common, scope: "openid email", prompt: "select_account" })}`;
  }
  if (id === "github") {
    return `https://github.com/login/oauth/authorize?${new URLSearchParams({ ...common, scope: "user:email" })}`;
  }
  if (id === "apple") {
    return `https://appleid.apple.com/auth/authorize?${new URLSearchParams({ ...common, response_mode: "query", scope: "email" })}`;
  }
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${new URLSearchParams({ ...common, scope: "openid email" })}`;
}

export type OAuthExchange = { ok: true; email: string; subject: string } | { ok: false; reason: "unverified" | "failed" };

export async function exchangeOAuthCode(input: {
  provider: OAuthProviderId;
  code: string;
  redirectUri: string;
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<OAuthExchange> {
  const creds = credentials(input.env, input.provider);
  if (!creds || !input.code || input.code.length > 2048) return { ok: false, reason: "failed" };
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    if (input.provider === "google") return await googleIdentity(creds, input.code, input.redirectUri, fetchImpl);
    if (input.provider === "github") return await githubIdentity(creds, input.code, input.redirectUri, fetchImpl);
    if (input.provider === "apple") return await appleIdentity(creds, input.code, input.redirectUri, fetchImpl);
    return await microsoftIdentity(creds, input.code, input.redirectUri, fetchImpl);
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export function providerAuthorizeUrl(id: OAuthProviderId, input: { redirectUri: string; state: string; env: NodeJS.ProcessEnv }): string | null {
  const creds = credentials(input.env, id);
  if (!creds) return null;
  return oauthAuthorizeUrl(id, { clientId: creds.clientId, redirectUri: input.redirectUri, state: input.state });
}

async function postForm(url: string, body: URLSearchParams, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": "Maximus" },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function getJson(url: string, token: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json", "user-agent": "Maximus" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function accessToken(payload: unknown): string | null {
  const token = record(payload)?.access_token;
  return typeof token === "string" && token.length > 0 && token.length <= 8192 ? token : null;
}

function confirmed(email: unknown, subject: unknown, verified: boolean): OAuthExchange {
  const address = typeof email === "string" ? normalizeAccountEmail(email) : null;
  const id = typeof subject === "string" || typeof subject === "number" ? String(subject) : "";
  if (!verified || !address || !/^[A-Za-z0-9._:-]{1,128}$/.test(id)) return { ok: false, reason: "unverified" };
  return { ok: true, email: address, subject: id };
}

async function googleIdentity(creds: { clientId: string; clientSecret: string }, code: string, redirectUri: string, fetchImpl: typeof fetch): Promise<OAuthExchange> {
  const token = accessToken(await postForm("https://oauth2.googleapis.com/token", new URLSearchParams({
    code, client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code",
  }), fetchImpl));
  if (!token) return { ok: false, reason: "failed" };
  const profile = record(await getJson("https://openidconnect.googleapis.com/v1/userinfo", token, fetchImpl));
  if (!profile) return { ok: false, reason: "failed" };
  return confirmed(profile.email, profile.sub, profile.email_verified === true);
}

async function githubIdentity(creds: { clientId: string; clientSecret: string }, code: string, redirectUri: string, fetchImpl: typeof fetch): Promise<OAuthExchange> {
  const token = accessToken(await postForm("https://github.com/login/oauth/access_token", new URLSearchParams({
    code, client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri,
  }), fetchImpl));
  if (!token) return { ok: false, reason: "failed" };
  const user = record(await getJson("https://api.github.com/user", token, fetchImpl));
  const emails = await getJson("https://api.github.com/user/emails", token, fetchImpl);
  if (!user || !Array.isArray(emails)) return { ok: false, reason: "failed" };
  const verified = emails.map(record).filter((row): row is Record<string, unknown> => row !== null && row.verified === true);
  const chosen = verified.find((row) => row.primary === true) ?? verified[0];
  return confirmed(chosen?.email, user.id, Boolean(chosen));
}

function appleEmail(idToken: unknown): { email: string; subject: string } | null {
  if (typeof idToken !== "string") return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const body = record(parsed);
  if (!body) return null;
  const verified = body.email_verified === true || body.email_verified === "true";
  const email = typeof body.email === "string" ? body.email : "";
  const subject = typeof body.sub === "string" ? body.sub : "";
  return verified && email && subject ? { email, subject } : null;
}

async function appleIdentity(creds: { clientId: string; clientSecret: string }, code: string, redirectUri: string, fetchImpl: typeof fetch): Promise<OAuthExchange> {
  const payload = record(await postForm("https://appleid.apple.com/auth/token", new URLSearchParams({
    code, client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code",
  }), fetchImpl));
  const identity = appleEmail(payload?.id_token);
  if (!identity) return { ok: false, reason: payload ? "unverified" : "failed" };
  return confirmed(identity.email, identity.subject, true);
}

async function microsoftIdentity(creds: { clientId: string; clientSecret: string }, code: string, redirectUri: string, fetchImpl: typeof fetch): Promise<OAuthExchange> {
  const token = accessToken(await postForm("https://login.microsoftonline.com/common/oauth2/v2.0/token", new URLSearchParams({
    code, client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code",
  }), fetchImpl));
  if (!token) return { ok: false, reason: "failed" };
  const profile = record(await getJson("https://graph.microsoft.com/oidc/userinfo", token, fetchImpl));
  if (!profile) return { ok: false, reason: "failed" };
  const email = profile.email ?? profile.preferred_username;
  return confirmed(email, profile.sub, typeof email === "string" && email.includes("@"));
}
