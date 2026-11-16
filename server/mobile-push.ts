import type { FcmPlatform } from "../shared/fcm.ts";
import type { NotificationLogEntry, NotifyKind } from "../shared/notification.ts";
import type { FcmSendResult, FcmSender } from "./mobile-push-fcm.ts";

/** A registered FCM token. `personKey` scopes Team Cloud
 * deliveries; personal installs leave it null and receive everything. */
export interface PushToken {
  token: string;
  platform: FcmPlatform;
  deviceName: string | null;
  personKey: string | null;
  appVersion: string | null;
}

export interface PushFanoutDeps {
  tokens: () => PushToken[];
  removeToken: (token: string) => void;
  /** Per-bot toggle (bot.notifications) and the global push switch. */
  botMuted: (botId: string) => boolean;
  globalEnabled: () => boolean;
  /** A desktop/web SSE stream is live: skip FCM to those tokens so the OS banner is not duplicated. Phones still get FYI. */
  desktopLive: () => boolean;
  sender: FcmSender | null;
  clock?: () => number;
}

/** Kinds that wait on the person: they always push, even muted.
 * FYI (`done`, notices) still skips muted bots and live web/desktop tokens. */
export const NEEDS_YOU: ReadonlySet<NotifyKind> = new Set([
  "approval",
  "question",
  "sign-in",
  "secret",
  "incident",
  "turn-failed",
  "routine-failed",
  "mention",
  "spend",
  "brief",
]);

/** APNs-path-mirroring limits: coalesce a thread's FYI banners to one per
 * minute, and cap each phone so a runaway bot cannot buzz it to death. */
export const FYI_THREAD_WINDOW_MS = 60_000;
export const FYI_PER_TOKEN_PER_HOUR = 20;
export const TOTAL_PER_TOKEN_PER_HOUR = 60;

export interface PushDecision {
  delivered: number;
  skipped: string;
}

export function createPushFanout(deps: PushFanoutDeps) {
  const clock = deps.clock ?? Date.now;
  /** token -> collapseKey -> last FYI send. needs-you never coalesces. */
  const lastFyiByThread = new Map<string, number>();
  /** token -> hourly send stamps (rolling window), split by urgency. */
  const sendsByToken = new Map<string, number[]>();
  const fyiByToken = new Map<string, number[]>();

  const hourly = (store: Map<string, number[]>, token: string, now: number): number[] => {
    const stamps = (store.get(token) ?? []).filter((at) => now - at < 3_600_000);
    store.set(token, stamps);
    return stamps;
  };

  async function fanout(entry: NotificationLogEntry): Promise<PushDecision> {
    if (deps.sender === null) return { delivered: 0, skipped: "push unavailable (no FCM credentials)" };
    if (!deps.globalEnabled()) return { delivered: 0, skipped: "push disabled" };
    const urgent = NEEDS_YOU.has(entry.kind);
    if (!urgent && deps.botMuted(entry.botId)) return { delivered: 0, skipped: "bot muted" };
    const now = clock();
    let delivered = 0;
    for (const target of deps.tokens()) {
      if (deps.desktopLive() && (target.platform === "web" || target.platform === "desktop")) continue;
      // A mention for one teammate never buzzes another's phone.
      if (entry.forPerson && target.personKey !== entry.forPerson) continue;
      if (hourly(sendsByToken, target.token, now).length >= TOTAL_PER_TOKEN_PER_HOUR) continue;
      if (!urgent) {
        if (hourly(fyiByToken, target.token, now).length >= FYI_PER_TOKEN_PER_HOUR) continue;
        const last = lastFyiByThread.get(`${target.token}:${entry.threadId}`) ?? 0;
        if (now - last < FYI_THREAD_WINDOW_MS) continue;
      }
      const result: FcmSendResult = await deps.sender.send({
        token: target.token,
        title: entry.title,
        body: entry.body,
        data: {
          kind: entry.kind,
          notificationId: entry.id,
          botId: entry.botId,
          threadId: entry.threadId,
          ...(entry.groupId ? { groupId: entry.groupId } : {}),
        },
        collapseKey: entry.threadId,
        highPriority: urgent,
      });
      if (result.ok) {
        delivered += 1;
        hourly(sendsByToken, target.token, now).push(now);
        if (!urgent) {
          hourly(fyiByToken, target.token, now).push(now);
          lastFyiByThread.set(`${target.token}:${entry.threadId}`, now);
        }
      } else if (result.deadToken) {
        deps.removeToken(target.token);
      }
    }
    return { delivered, skipped: delivered ? "" : "no devices" };
  }

  return { fanout, urgent: (kind: NotifyKind): boolean => NEEDS_YOU.has(kind) };
}
