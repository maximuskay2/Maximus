import { useSyncExternalStore } from "react";
import { readSessionState, type SessionState } from "./session";

export const SESSION_ENDED_REASON = "Your session ended. Pair this device again to keep using it.";
const ENDED_KEY = "maximus.session-ended";

let ended = false;
let checking: Promise<void> | null = null;
const listeners = new Set<() => void>();

function markEnded(): void {
  if (ended) return;
  ended = true;
  try { sessionStorage.setItem(ENDED_KEY, "1"); } catch { }
  for (const listener of listeners) listener();
}

/** This window is not in an account session. A missed server stays as it was. */
function applySession(state: SessionState): void {
  if (state.kind === "session" || state.kind === "unreachable") return;
  markEnded();
}

/** Drop the open chat now. Sign-out uses this before the server answers, so the bot list does not linger. */
export function markSessionEnded(): void {
  markEnded();
}

function checkSession(): Promise<void> {
  if (ended) return Promise.resolve();
  if (checking) return checking;
  checking = readSessionState().then(applySession).finally(() => { checking = null; });
  return checking;
}

/** A request was refused (401/403): asks the server once whether this device is still signed in. */
export function noteRefusedRequest(): void {
  void checkSession();
}

/** The open chat asks again when the window comes forward. Anything but a live account session leaves the chat. */
export function confirmOpenSession(): Promise<void> {
  return checkSession();
}

/** The check a refused request started, if one is running. */
export function sessionCheck(): Promise<void> {
  return checking ?? Promise.resolve();
}

export function sessionEnded(): boolean {
  return ended;
}

export function useSessionEnded(): boolean {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, sessionEnded, sessionEnded);
}

/** This tab saw its session end before it reloaded: the pairing page says so. */
export function endedBeforeReload(): boolean {
  try { return sessionStorage.getItem(ENDED_KEY) === "1"; } catch { return false; }
}

export function forgetEndedSession(): void {
  try { sessionStorage.removeItem(ENDED_KEY); } catch { }
}
