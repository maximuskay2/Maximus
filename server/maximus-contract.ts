// This versions only the hosted consume/check wire contract, not the app release.
export const MAXIMUS_CONTRACT_VERSION = 1;
export const MAXIMUS_CONTRACT_HEADER = "x-maximus-contract-version";
export const MAXIMUS_CONTRACT_METADATA = Object.freeze({
  contractVersion: MAXIMUS_CONTRACT_VERSION,
  supportedContractVersions: Object.freeze([MAXIMUS_CONTRACT_VERSION]),
  legacyPolicy: "legacy-v1",
});
export const MAXIMUS_CONTRACT_MISMATCH = "MAXIMUS_CONTRACT_MISMATCH";
export const MAXIMUS_CONTRACT_ERROR = "Admin and workspace runtime versions are incompatible. Ask your administrator to update the deployment.";

/** legacy-v1 accepts an omitted version only for the v1 payload; never infer compatibility from app versions. */
export function maximusContractCompatible(version: unknown): boolean {
  return version === undefined ? MAXIMUS_CONTRACT_VERSION === 1 : version === MAXIMUS_CONTRACT_VERSION;
}
