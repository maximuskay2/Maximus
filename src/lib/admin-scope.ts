import { isOwnerOrAdmin, readSessionState } from "./session";

const refused = new Set<string>();
let admin: boolean | null = null;
let looking: Promise<boolean> | null = null;

export function lacksAdminScope(cause: unknown): boolean {
  const error = Object(cause) as { status?: unknown; message?: unknown };
  return error.status === 403 && typeof error.message === "string" && error.message.includes("lacks the admin scope");
}

/** True when this page should call an admin route. A known client session is false, so the browser never fires the 403. */
export function mayAskAdminRoute(): Promise<boolean> {
  if (admin !== null) return Promise.resolve(admin);
  looking ??= readSessionState()
    .then((state) => {
      if (state.kind === "unreachable") return true;
      admin = isOwnerOrAdmin(state);
      return admin;
    })
    .catch(() => true)
    .finally(() => { looking = null; });
  return looking;
}

/** Asks for `route` until this session is not an admin; from then on answers `refusedAnswer` without asking again. */
export async function unlessRefused<T>(route: string, request: () => Promise<T>, refusedAnswer: T): Promise<T> {
  if (refused.has(route)) return refusedAnswer;
  if (!(await mayAskAdminRoute())) {
    refused.add(route);
    return refusedAnswer;
  }
  try {
    return await request();
  } catch (cause) {
    if (!lacksAdminScope(cause)) throw cause;
    refused.add(route);
    return refusedAnswer;
  }
}
