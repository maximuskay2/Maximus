import { afterAll, afterEach, beforeAll } from "vitest";

import { resetTestDatabase, setupTestDatabase, teardownTestDatabase } from "./harness.ts";

beforeAll(async () => {
  await setupTestDatabase();
});

afterEach(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});
