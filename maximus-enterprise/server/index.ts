// Copyright (c) 2026 Maximus. All rights reserved.
// Proprietary and confidential: this file is part of the Maximus Enterprise
// layer and is licensed under the Maximus Enterprise License
// (maximus-enterprise/LICENSE), not the Apache License 2.0.

// The layer entry core dynamically loads (see enterpriseLayerDirs in
// server/enterprise.ts): its one obligation is register(), turning
// MAXIMUS_LICENSE_KEY into entitlements, plus the optional hosted sign-in
// adapter. Never imported statically by core.
import { LICENSE_GRACE_DAYS, verifyLicense } from "../license.ts";

export { createWorkspaceAccess } from "../workspace-access.ts";

const DAY_MS = 24 * 60 * 60_000;

export interface RegisterOptions {
  licenseKey: string;
  /** Core's grace period in days; a key expired longer ago is refused at startup. */
  graceDays: number;
  /** Test-only key override; production always verifies against the baked keys. */
  publicKeys?: readonly string[];
  now?: number;
}

export interface RegisteredLayer {
  customer: string;
  features: string[];
  expiresAt: string | null;
}

/** Never returns an expired-beyond-grace key: core would grant nothing for it anyway. */
export async function register(options: RegisterOptions): Promise<RegisteredLayer> {
  const graceDays = Number.isFinite(options.graceDays) && options.graceDays >= 0 ? options.graceDays : LICENSE_GRACE_DAYS;
  const now = options.now ?? Date.now();
  const verified = verifyLicense(options.licenseKey, { publicKeys: options.publicKeys, now });
  if (verified.expires) {
    const at = new Date(verified.expires).getTime();
    if (now >= at + graceDays * DAY_MS) {
      throw new Error(`MAXIMUS_LICENSE_KEY expired on ${verified.expires}; renew it to keep enterprise features`);
    }
  }
  return { customer: verified.customer, features: [...verified.features], expiresAt: verified.expires };
}
