#!/usr/bin/env node
// Copyright (c) 2026 Maximus. All rights reserved.
// Proprietary and confidential: licensed under the Maximus Enterprise License
// (maximus-enterprise/LICENSE), not the Apache License 2.0.
//
// Issues a max1. license key with the signing key (kept outside the repo,
// mode 0600). The signing logic mirrors issueLicense() in
// maximus-enterprise/license.ts; this script stays dependency-free plain
// JavaScript so it runs anywhere Node 24+ runs.
//
// Usage: node maximus-enterprise/scripts/issue-license.mjs --key <pem> \
//   --customer "Acme" --features whitelabel,admin --issued 2026-11-07 \
//   --expires 2027-11-07   (or --expires never for a perpetual key)
import { sign } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => {
  const value = args[args.indexOf(name) + 1];
  return value && !value.startsWith("--") ? value : undefined;
};
const keyPath = flag("--key");
const customer = flag("--customer");
const features = flag("--features");
const issued = flag("--issued");
const expires = flag("--expires");
if (!keyPath || !customer || features === undefined || !issued || !expires) {
  console.error('usage: issue-license.mjs --key <pem> --customer <name> --features <a,b> --issued <YYYY-MM-DD> --expires <YYYY-MM-DD|never>');
  process.exit(2);
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const calendarDate = (value) => {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
};
if (!customer.trim() || customer.length > 160) {
  console.error("customer must be a non-empty string of at most 160 characters");
  process.exit(1);
}
const featureList = features ? features.split(",").map((f) => f.trim()).filter(Boolean) : [];
if (featureList.some((f) => f.length > 64)) {
  console.error("features must be non-empty strings of at most 64 characters");
  process.exit(1);
}
if (!calendarDate(issued)) {
  console.error("issued must be a YYYY-MM-DD date");
  process.exit(1);
}
if (expires !== "never" && !calendarDate(expires)) {
  console.error("expires must be a YYYY-MM-DD date or \"never\"");
  process.exit(1);
}
const claims = { v: 1, customer, features: featureList, issued, expires: expires === "never" ? null : expires };
const claimsPart = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
const signature = sign(null, Buffer.from(claimsPart, "utf8"), { key: readFileSync(keyPath, "utf8"), format: "pem" });
console.log(`max1.${claimsPart}.${signature.toString("base64url")}`);
