import { afterEach, expect, it } from "vitest";

import { accountChoiceFromPlan, rememberPendingPlan, takePendingPlan } from "./pending-plan";

afterEach(() => {
  sessionStorage.clear();
});

it("maps pricing plans onto account choices", () => {
  expect(accountChoiceFromPlan("free")).toBe("free");
  expect(accountChoiceFromPlan("byo")).toBe("byo");
  expect(accountChoiceFromPlan("starter")).toBe("muse");
  expect(accountChoiceFromPlan("plus")).toBe("muse");
});

it("remembers a pending plan once", () => {
  rememberPendingPlan("starter");
  expect(takePendingPlan()).toBe("starter");
  expect(takePendingPlan()).toBeNull();
});
