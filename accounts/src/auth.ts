import type { AccountsEnv, AccountsConfig, JobContext } from "./types.ts";
import { betterAuth } from "better-auth";
import { bearer, emailOTP } from "better-auth/plugins";
import type { Pool } from "pg";

import { resolveOTPTransport, sendOTPEmail } from "./email.ts";

const SOCIAL_SIGN_IN = [
  ["github", "GitHub", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
  ["google", "Google", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  ["apple", "Apple", "APPLE_CLIENT_ID", "APPLE_CLIENT_SECRET"],
  ["microsoft", "Microsoft", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
] as const;

function socialSecret(env: AccountsEnv, key: string): string {
  const value = (env as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Providers with both a client id and a secret. The secret never leaves the worker. */
export function configuredSocialSignIn(env: AccountsEnv): { id: string; label: string }[] {
  return SOCIAL_SIGN_IN.flatMap(([id, label, idKey, secretKey]) => (
    socialSecret(env, idKey) && socialSecret(env, secretKey) ? [{ id, label }] : []
  ));
}

function socialProviders(env: AccountsEnv): Record<string, { clientId: string; clientSecret: string }> {
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};
  for (const [id, , idKey, secretKey] of SOCIAL_SIGN_IN) {
    const clientId = socialSecret(env, idKey);
    const clientSecret = socialSecret(env, secretKey);
    if (clientId && clientSecret) providers[id] = { clientId, clientSecret };
  }
  return providers;
}

/** The browser may receive the account token only on our own sign-in page, and only in the fragment. */
export function socialHandoffLocation(location: string, token: string, email: string, allowed: ReadonlySet<string>): string | null {
  if (!token || token.length > 4096 || /\s/.test(token)) return null;
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 320) return null;
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return null;
  }
  if (url.username || url.password || url.hash || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  if (!allowed.has(url.origin) || url.pathname !== "/signin") return null;
  url.hash = `account=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  return url.toString();
}

export function createAuth(
  env: AccountsEnv,
  ctx: JobContext,
  config: AccountsConfig,
  requestId: string,
  pool: Pool,
) {
  const providers = socialProviders(env);
  return betterAuth({
    appName: "Maximus",
    baseURL: config.authBaseURL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    ...(Object.keys(providers).length > 0 ? { socialProviders: providers } : {}),
    database: pool,
    trustedOrigins: [...config.allowedOrigins],
    logger: { disabled: true },
    // Better Auth would otherwise delete expired verification rows inline on
    // every OTP check. Expired codes still fail their expiresAt check; the
    // sweep runs after the sign-in response.
    verification: { disableCleanup: true },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/email-otp/send-verification-otp": { window: 60, max: 5 },
        "/sign-in/email-otp": { window: 60, max: 10 },
      },
    },
    advanced: {
      useSecureCookies: true,
      ipAddress: {
        // The server sets this header from the trusted proxy chain. Do not
        // trust a client-supplied x-forwarded-for chain for rate limits or
        // session metadata.
        ipAddressHeaders: ["cf-connecting-ip"],
      },
      // Better Auth 1.7.3+ introspects the database as each auth instance
      // starts (once per request here) and makes auth requests wait on it:
      // one more round trip per request for a schema the migrations fix.
      // Postgres reports native UUIDs, so "uuid" would leave id generation
      // to a column default the text-id schema does not have. Generate the
      // same client-side UUIDs the D1 deployment uses.
      database: { generateId: () => crypto.randomUUID(), validateSchema: false },
      backgroundTasks: {
        handler(promise) {
          ctx.waitUntil(promise);
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 8,
        expiresIn: 10 * 60,
        allowedAttempts: 5,
        storeOTP: "hashed",
        resendStrategy: "rotate",
        disableSignUp: false,
        rateLimit: { window: 60, max: 5 },
        async sendVerificationOTP(input) {
          await sendOTPEmail(
            resolveOTPTransport(env, {
              async send(message) {
                await env.EMAIL.send(message);
              },
            }),
            config.emailFrom,
            input,
            requestId,
          );
        },
      }),
      bearer({ requireSignature: true }),
    ],
  });
}

export type ControlPlaneAuth = ReturnType<typeof createAuth>;

/**
 * The expired-verification cleanup that `verification.disableCleanup` turns
 * off, as a single DELETE. It calls the adapter directly, so it skips
 * verification delete hooks. None are registered (emailOTP and bearer add
 * none); revisit this if databaseHooks are added or better-auth is upgraded.
 */
export async function deleteExpiredVerifications(auth: ControlPlaneAuth): Promise<void> {
  const context = await auth.$context;
  await context.adapter.deleteMany({
    model: "verification",
    where: [{ field: "expiresAt", operator: "lt", value: new Date() }],
  });
}

/** Better Auth puts the signed session on `set-auth-token` before it redirects. Move that token into the sign-in page fragment. */
export async function socialCallbackHandoff(response: Response, auth: ControlPlaneAuth, allowed: ReadonlySet<string>): Promise<Response | null> {
  if (response.status < 300 || response.status >= 400) return null;
  const token = response.headers.get("set-auth-token");
  const location = response.headers.get("location");
  if (!token || !location) return null;
  const session = await accountSession(new Request("https://control.invalid/api/auth/callback", {
    headers: { authorization: `Bearer ${token}` },
  }), auth).catch(() => null);
  const email = session?.user.email;
  if (!email) return null;
  const next = socialHandoffLocation(location, token, email, allowed);
  if (!next) return null;
  const headers = new Headers(response.headers);
  headers.set("location", next);
  headers.delete("set-auth-token");
  return new Response(null, { status: response.status, headers });
}

export async function accountSession(request: Request, auth: ControlPlaneAuth) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match || match[1].startsWith("maximus_install_")) return null;

  return auth.api.getSession({
    headers: new Headers({ authorization: `Bearer ${match[1]}` }),
  });
}
