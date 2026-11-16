export const FCM_PLATFORMS = ["ios", "android", "web", "desktop"] as const;
export type FcmPlatform = (typeof FCM_PLATFORMS)[number];

export function isFcmPlatform(value: unknown): value is FcmPlatform {
  return typeof value === "string" && (FCM_PLATFORMS as readonly string[]).includes(value);
}
