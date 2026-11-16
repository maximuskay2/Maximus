import {
  fcmRegistration,
  registerFcmToken,
  unregisterFcmToken,
  type FirebaseWebConfig,
} from "./fcm-client";

async function firebaseWebToken(config: FirebaseWebConfig): Promise<string | null> {
  if (!config.vapidKey || typeof navigator === "undefined" || !navigator.serviceWorker) return null;
  try {
    const { getApps, initializeApp } = await import("firebase/app");
    const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
    if (!(await isSupported())) return null;
    const app = getApps()[0] ?? initializeApp(config);
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { type: "module" });
    return await getToken(getMessaging(app), { vapidKey: config.vapidKey, serviceWorkerRegistration: registration });
  } catch {
    return null;
  }
}

let lastToken: string | null = null;
let starting: Promise<void> | null = null;

/** Registers this browser or desktop window for FCM. Safe to call on every Settings grant. */
export function startFcmPush(): Promise<void> {
  starting ??= (async () => {
    const desktopToken = window.ogb?.desktopNotifications?.fcmToken;
    const registration = await fcmRegistration({
      desktopToken,
      webToken: firebaseWebToken,
      version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : undefined,
    });
    if (!registration) return;
    if (lastToken && lastToken !== registration.token) await unregisterFcmToken(lastToken);
    if (await registerFcmToken(registration, {
      deviceName: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : undefined,
      version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : undefined,
    })) {
      lastToken = registration.token;
    }
  })().finally(() => { starting = null; });
  return starting;
}
