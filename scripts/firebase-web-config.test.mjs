import { describe, expect, it } from "vitest";

import { firebaseWebConfig } from "./firebase-web-config.ts";

describe("firebase web config", () => {
  it("ships the Maximus web app and VAPID key", () => {
    const cfg = firebaseWebConfig({});
    expect(cfg).toMatchObject({
      projectId: "maximusbot-e2702",
      messagingSenderId: "78173460265",
      appId: "1:78173460265:web:de42047fe6f4a810444938",
      vapidKey: "BGWRPS6FOxhqhZsmSulDh2lFlZKI8sVDvs03qrIrQYolU7qbvWqT18aBQESAzl35-ohyYsg4hz7qi1EIbeUSvTo",
    });
  });

  it("lets the web appId be overridden at build", () => {
    expect(firebaseWebConfig({ VITE_FIREBASE_APP_ID: "1:1:web:abc" }).appId).toBe("1:1:web:abc");
  });
});
