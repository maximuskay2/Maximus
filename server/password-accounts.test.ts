import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { createPasswordAccounts } from "./password-accounts.ts";

it("creates an account, signs in, and keeps the password off disk", () => {
  const accounts = createPasswordAccounts(join(mkdtempSync(join(tmpdir(), "maximus-accounts-")), "password-accounts.json"));
  expect(accounts.signup("Ada@Example.com", "short")).toEqual({ ok: false, reason: "short-password" });
  expect(accounts.signup("not-an-email", "long-enough")).toEqual({ ok: false, reason: "invalid-email" });
  expect(accounts.signup("Ada@Example.com", "correct-horse")).toEqual({ ok: true, email: "ada@example.com", owner: true });
  expect(accounts.signup("ada@example.com", "correct-horse")).toEqual({ ok: false, reason: "taken" });
  expect(accounts.signin("ada@example.com", "wrong-horse")).toEqual({ ok: false, reason: "wrong" });
  expect(accounts.signin("ada@example.com", "correct-horse")).toEqual({ ok: true, email: "ada@example.com", owner: true });
  expect(JSON.stringify(accounts.list())).not.toContain("correct-horse");
  expect(accounts.signup("bea@example.com", "another-secret")).toMatchObject({ ok: true, owner: false });
  expect(accounts.signin("bea@example.com", "another-secret")).toMatchObject({ ok: true, owner: false });
});
