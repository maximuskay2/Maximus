import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PRODUCT_ACCOUNTS_ORIGIN, PRODUCT_PUBLIC_ORIGIN } from "./product-origin.mjs";

const shared = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../shared/product-origin.ts"), "utf8");

test("electron product origins match shared/product-origin.ts", () => {
  assert.match(shared, new RegExp(`PRODUCT_PUBLIC_ORIGIN = "${PRODUCT_PUBLIC_ORIGIN}"`));
  assert.match(shared, new RegExp(`PRODUCT_ACCOUNTS_ORIGIN = "${PRODUCT_ACCOUNTS_ORIGIN}"`));
});
