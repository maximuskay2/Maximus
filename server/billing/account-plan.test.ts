import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AccountPlans } from "./account-plan.ts";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("an account's plan follows the email", () => {
  it("keeps the choice for the next device and does not let free replace a paid plan", () => {
    const folder = mkdtempSync(join(tmpdir(), "account-plan-"));
    folders.push(folder);
    const first = new AccountPlans(folder);
    expect(first.get("Ada@example.com")).toBeNull();
    expect(first.choose("Ada@example.com", "free")).toBe("free");
    const second = new AccountPlans(folder);
    expect(second.get("ada@example.com")).toBe("free");
    expect(second.choose("ada@example.com", "free")).toBe("free");
    expect(second.choose("ada@example.com", "muse")).toBe("muse");
    expect(second.choose("ada@example.com", "free")).toBe("muse");
    expect(new AccountPlans(folder).get("ada@example.com")).toBe("muse");
  });

  it("treats a Gmail plus alias as the same mailbox", () => {
    const folder = mkdtempSync(join(tmpdir(), "account-plan-gmail-"));
    folders.push(folder);
    const plans = new AccountPlans(folder);
    expect(plans.choose("Ada.O+free@gmail.com", "free")).toBe("free");
    expect(plans.get("adao@gmail.com")).toBe("free");
    expect(plans.choose("adao@googlemail.com", "byo")).toBe("byo");
  });
});
