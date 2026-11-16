import { isFcmPlatform, type FcmPlatform } from "../../shared/fcm";

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId: string;
  appId: string;
  vapidKey?: string;
}

export interface FcmRegistration {
  token: string;
  platform: FcmPlatform;
}

export interface FcmClientDeps {
  fetchImpl?: typeof fetch;
  permission?: () => NotificationPermission;
  desktopToken?: (senderId: string) => Promise<string | null>;
  webToken?: (config: FirebaseWebConfig) => Promise<string | null>;
  version?: string;
  platform?: () => FcmPlatform;
}

const REGISTER = "/v1/installations/self/push/register";

export async function loadFirebaseWebConfig(fetchImpl: typeof fetch = fetch): Promise<FirebaseWebConfig | null> {
  try {
    const res = await fetchImpl("/firebase-web.json", { credentials: "same-origin" });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!body || typeof body !== "object") return null;
    const record = body as Record<string, unknown>;
    if (typeof record.apiKey !== "string" || typeof record.projectId !== "string" || typeof record.messagingSenderId !== "string") {
      return null;
    }
    if (!record.apiKey || !record.projectId || !record.messagingSenderId) return null;
    return {
      apiKey: record.apiKey,
      projectId: record.projectId,
      messagingSenderId: record.messagingSenderId,
      appId: typeof record.appId === "string" ? record.appId : "",
      ...(typeof record.authDomain === "string" ? { authDomain: record.authDomain } : {}),
      ...(typeof record.storageBucket === "string" ? { storageBucket: record.storageBucket } : {}),
      ...(typeof record.vapidKey === "string" && record.vapidKey ? { vapidKey: record.vapidKey } : {}),
    };
  } catch {
    return null;
  }
}

export function thisFcmPlatform(): FcmPlatform {
  return typeof window !== "undefined" && window.ogb ? "desktop" : "web";
}

export async function fcmRegistration(deps: FcmClientDeps = {}): Promise<FcmRegistration | null> {
  const permission = deps.permission?.() ?? (typeof Notification === "undefined" ? "denied" : Notification.permission);
  if (permission !== "granted") return null;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const config = await loadFirebaseWebConfig(fetchImpl);
  const platform = deps.platform?.() ?? thisFcmPlatform();
  if (!isFcmPlatform(platform)) return null;
  let token: string | null = null;
  if (platform === "desktop" && deps.desktopToken && config?.messagingSenderId) {
    token = await deps.desktopToken(config.messagingSenderId);
  }
  if (!token && config && deps.webToken) token = await deps.webToken(config);
  if (!token || token.length > 4096) return null;
  return { token, platform };
}

export async function registerFcmToken(registration: FcmRegistration, deps: { fetchImpl?: typeof fetch; deviceName?: string; version?: string } = {}): Promise<boolean> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(REGISTER, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: registration.token,
        platform: registration.platform,
        ...(deps.deviceName ? { deviceName: deps.deviceName } : {}),
        ...(deps.version ? { appVersion: deps.version } : {}),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function unregisterFcmToken(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await fetchImpl(REGISTER, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch {
    /* the next register replaces it */
  }
}
