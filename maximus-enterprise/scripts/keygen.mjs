#!/usr/bin/env node
// Copyright (c) 2026 Maximus. All rights reserved.
// Proprietary and confidential: licensed under the Maximus Enterprise License
// (maximus-enterprise/LICENSE), not the Apache License 2.0.
//
// Generates a fresh Ed25519 license-signing keypair. The private key is
// written with mode 0600 outside the repo and never printed; bake the printed
// public key into LICENSE_PUBLIC_KEYS in maximus-enterprise/license.ts
// (append to rotate, never edit or remove a live entry).
//
// Usage: node maximus-enterprise/scripts/keygen.mjs --out /secure/path/maximus-license-signing.key [--force]
import { generateKeyPairSync } from "node:crypto";
import { existsSync, chmodSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const out = args[args.indexOf("--out") + 1];
const force = args.includes("--force");
if (!out || out.startsWith("--")) {
  console.error("usage: keygen.mjs --out <private-key-path> [--force]");
  process.exit(2);
}
if (existsSync(out) && !force) {
  console.error(`refusing to overwrite ${out} (pass --force to rotate into the same path)`);
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
writeFileSync(out, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
chmodSync(out, 0o600);
console.log(`private key written to ${out} (0600; keep it outside the repo)`);
console.log(`public key to bake into LICENSE_PUBLIC_KEYS:\n${publicKey.export({ format: "jwk" }).x}`);
