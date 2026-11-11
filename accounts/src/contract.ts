// Hosted wire-contract guard (contracts section 6). This versions only the
// hosted consume/check/admin wire contract, not the app release; it mirrors
// server/maximus-contract.ts. An omitted version is accepted only for the v1
// payload (legacy-v1 policy); any other mismatch fails with
// MAXIMUS_CONTRACT_MISMATCH, never a silent downgrade.
import { HTTPError, JSON_HEADERS } from "./http.ts";

export const MAXIMUS_CONTRACT_VERSION = 1;
export const MAXIMUS_CONTRACT_HEADER = "x-maximus-contract-version";
export const MAXIMUS_CONTRACT_MISMATCH = "MAXIMUS_CONTRACT_MISMATCH";

export function contractVersionOf(request: Request): string | undefined {
  return request.headers.get(MAXIMUS_CONTRACT_HEADER) ?? undefined;
}

/** Throws a 409 mismatch error; callers stamp the version header on success. */
export function assertContract(request: Request): void {
  const version = contractVersionOf(request);
  if (version === undefined) {
    if (MAXIMUS_CONTRACT_VERSION !== 1) throw new HTTPError(409, MAXIMUS_CONTRACT_MISMATCH);
    return;
  }
  if (version !== String(MAXIMUS_CONTRACT_VERSION)) throw new HTTPError(409, MAXIMUS_CONTRACT_MISMATCH);
}

/** Success responses on versioned routes carry the contract version. */
export function contractJSON(value: unknown, status = 200): Response {
  const response = new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
  response.headers.set(MAXIMUS_CONTRACT_HEADER, String(MAXIMUS_CONTRACT_VERSION));
  return response;
}
