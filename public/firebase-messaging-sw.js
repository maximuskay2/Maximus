import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getMessaging, onBackgroundMessage } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-sw.js";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const params = new URLSearchParams();
  if (data.botId) params.set("botId", String(data.botId));
  if (data.threadId) params.set("threadId", String(data.threadId));
  const target = `/${params.size ? `?${params}` : ""}`;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => "focus" in client);
      if (existing) {
        existing.postMessage({ type: "maximus-push-open", botId: data.botId, threadId: data.threadId });
        return existing.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});

try {
  const cfg = await (await fetch("/firebase-web.json")).json();
  if (cfg?.apiKey && cfg?.projectId) {
    const messaging = getMessaging(initializeApp(cfg));
    onBackgroundMessage(messaging, (payload) => {
      const title = payload.notification?.title || payload.data?.title || "Maximus";
      const body = payload.notification?.body || payload.data?.body || "";
      return self.registration.showNotification(title, {
        body,
        icon: "/app-icon-192.png",
        tag: payload.data?.threadId || "maximus",
        data: payload.data || {},
      });
    });
  }
} catch {
  /* missing config: the page still runs */
}
