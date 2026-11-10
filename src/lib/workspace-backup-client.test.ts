import { describe, expect, it } from "vitest";
import { applyWorkspaceClientState, collectWorkspaceClientState } from "./workspace-backup-client";
import { SEND_KEY_KEY } from "./send-key";

function memory(values: Record<string, string>) {
  const entries = new Map(Object.entries(values));
  return { entries, getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}

describe("full-backup browser state", () => {
  it("exports exact app drafts/preferences, never saved webhook credentials or auth/cache keys", () => {
    const storage = memory({ "maximus-drafts": "draft", "maximus-webhook-credentials": "private URL", "maximus-skin": "daylight", "auth-token": "secret", "maximus-connected-apps": "cached accounts", "maximus-email-gate": "identity", "maximus-pending-workspace-restore": "old" });
    expect(collectWorkspaceClientState(storage)).toEqual({ "maximus-drafts": "draft", "maximus-skin": "daylight" });
  });

  it("replaces only allowlisted keys and clears old drafts absent from the backup", () => {
    const storage = memory({ "maximus-drafts": "old", "maximus-draft-attachments": "old attachment", "auth-token": "keep", "maximus-webhook-credentials": "destination URL" });
    applyWorkspaceClientState({ "maximus-drafts": "restored", "maximus-show-threads": "false" }, storage);
    expect(Object.fromEntries(storage.entries)).toEqual({ "maximus-drafts": "restored", "maximus-show-threads": "false", "auth-token": "keep", "maximus-webhook-credentials": "destination URL" });
  });

  it("carries the run card visibility choice in a workspace backup", () => {
    const storage = memory({ "maximus-show-run-card": "0" });
    expect(collectWorkspaceClientState(storage)).toEqual({ "maximus-show-run-card": "0" });
    applyWorkspaceClientState({ "maximus-show-run-card": "1" }, storage);
    expect(storage.getItem("maximus-show-run-card")).toBe("1");
  });

  it("carries the send key choice in a workspace backup", () => {
    const storage = memory({ [SEND_KEY_KEY]: "mod-enter" });
    expect(collectWorkspaceClientState(storage)).toEqual({ "maximus-send-key": "mod-enter" });
    applyWorkspaceClientState({ "maximus-send-key": "enter" }, storage);
    expect(storage.getItem(SEND_KEY_KEY)).toBe("enter");
  });

  it("carries the message color choice and leaves older backups opted out", () => {
    const storage = memory({ "maximus-color-user-bubbles": "1" });
    expect(collectWorkspaceClientState(storage)).toEqual({ "maximus-color-user-bubbles": "1" });
    applyWorkspaceClientState({ "maximus-color-user-bubbles": "0" }, storage);
    expect(storage.getItem("maximus-color-user-bubbles")).toBe("0");
    applyWorkspaceClientState({}, storage);
    expect(storage.getItem("maximus-color-user-bubbles")).toBeNull();
  });

  it("carries the chat width choice and clears it for older backups", () => {
    const storage = memory({ "maximus-chat-width": "full" });
    expect(collectWorkspaceClientState(storage)).toEqual({ "maximus-chat-width": "full" });
    applyWorkspaceClientState({ "maximus-chat-width": "wide" }, storage);
    expect(storage.getItem("maximus-chat-width")).toBe("wide");
    applyWorkspaceClientState({}, storage);
    expect(storage.getItem("maximus-chat-width")).toBeNull();
  });

  it.each([null, [], { "auth-token": "injected" }, { "maximus-webhook-credentials": "source URL" }, { "maximus-drafts": 1 }])("rejects invalid client state before clearing anything (%j)", (value) => {
    const storage = memory({ "maximus-drafts": "old", "auth-token": "keep" });
    expect(() => applyWorkspaceClientState(value, storage)).toThrow("Invalid backup browser state");
    expect(Object.fromEntries(storage.entries)).toEqual({ "maximus-drafts": "old", "auth-token": "keep" });
  });

  it("rolls browser state back if restored values exceed storage quota", () => {
    const storage = memory({ "maximus-drafts": "old", "maximus-skin": "daylight", "auth-token": "keep" });
    const original = storage.setItem;
    storage.setItem = (key, value) => { if (value === "too large") throw new Error("quota"); original(key, value); };
    expect(() => applyWorkspaceClientState({ "maximus-drafts": "too large" }, storage)).toThrow("quota");
    expect(Object.fromEntries(storage.entries)).toEqual({ "maximus-drafts": "old", "maximus-skin": "daylight", "auth-token": "keep" });
  });
});
