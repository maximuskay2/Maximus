const KEY = "maximus.grant.install";

/** Stable per browser profile / desktop partition. Sent as `x-maximus-install`. */
export function grantInstallId(): string | null {
  try {
    const local = globalThis.localStorage;
    if (!local) return null;
    const existing = local.getItem(KEY);
    if (existing && existing.length >= 8 && existing.length <= 320) return existing;
    const fresh = globalThis.crypto?.randomUUID?.() ?? `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    local.setItem(KEY, fresh);
    return local.getItem(KEY) === fresh ? fresh : existing;
  } catch {
    return null;
  }
}

export function applyGrantInstallHeader(headers: Headers | Record<string, string>): void {
  const id = grantInstallId();
  if (!id) return;
  if (headers instanceof Headers) headers.set("x-maximus-install", id);
  else headers["x-maximus-install"] = id;
}
