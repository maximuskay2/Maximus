import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { installDesktopFcm } from "./desktop-fcm.mjs";

test("registers an FCM token for this desktop and persists credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "maximus-fcm-"));
  let handler = null;
  const seen = [];
  installDesktopFcm({
    ipcMain: { handle: (channel, run) => { assert.equal(channel, "desktop-fcm:token"); handler = run; } },
    userData: dir,
    onMessage: (note) => seen.push(note),
    registerImpl: async (senderId) => {
      assert.equal(senderId, "78173460265");
      return { fcm: { token: "desk-token" } };
    },
    listenImpl: async (creds, onNote) => {
      assert.equal(creds.fcm.token, "desk-token");
      onNote({ notification: { title: "Scout", body: "done", data: { botId: "b1", threadId: "t1" } } });
    },
  });
  assert.equal(await handler({}, "78173460265"), "desk-token");
  assert.equal(JSON.parse(readFileSync(join(dir, "fcm-credentials.json"), "utf8")).fcm.token, "desk-token");
  assert.deepEqual(seen, [{ title: "Scout", body: "done", botId: "b1", threadId: "t1" }]);
});

test("rejects a sender id that is not this Firebase project number", async () => {
  let handler = null;
  installDesktopFcm({
    ipcMain: { handle: (_c, run) => { handler = run; } },
    userData: mkdtempSync(join(tmpdir(), "maximus-fcm-")),
    onMessage: () => {},
    registerImpl: async () => ({ fcm: { token: "nope" } }),
  });
  assert.equal(await handler({}, "abc"), null);
});
