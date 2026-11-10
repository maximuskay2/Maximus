import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_FLEET } from "./instance-fleets.ts";
import {
  instanceProvider, isKnownProviderId, PROVIDER_IDS, PROVIDER_INSTANCES, PROVIDER_LABELS, resolveProvider,
  switchboardInstanceRefusal, switchboardSelectionRefusal,
} from "./switchboard.ts";

afterEach(() => {
  delete process.env.MAXIMUS_OPERATOR_PROVIDERS;
  delete process.env.MAXIMUS_WORKSPACE_PROVIDERS;
});

describe("provider switchboard", () => {
  it("leaves every provider on when nothing is configured", () => {
    for (const id of PROVIDER_IDS) {
      expect(resolveProvider(id, { operator: { providers: {} }, workspace: { providers: {} } })).toEqual({ allowed: true, mode: "byo" });
      expect(resolveProvider(id, undefined, {})).toEqual({ allowed: true, mode: "byo" });
    }
    for (const instances of Object.values(PROVIDER_INSTANCES)) {
      for (const instanceId of instances) expect(switchboardInstanceRefusal(instanceId, undefined, {})).toBeUndefined();
    }
  });

  it("covers five providers times three levels", () => {
    // Level 1 (operator) off beats everything below it, first "off" wins with its reason.
    for (const id of PROVIDER_IDS) {
      const label = PROVIDER_LABELS[id];
      const killed = resolveProvider(id, {
        operator: { providers: { [id]: { enabled: false, reason: "provider incident" } } },
        workspace: { providers: { [id]: { mode: "bundled", models: ["m1"] } } },
      });
      expect(killed).toEqual({ allowed: false, reason: "provider incident", level: "operator" });
      const killedDefault = resolveProvider(id, { operator: { providers: { [id]: { enabled: false } } }, workspace: { providers: {} } });
      expect(killedDefault).toEqual({ allowed: false, reason: `${label} is turned off by the operator.`, level: "operator" });
      // Level 2 (workspace) off / bundled / byo.
      expect(resolveProvider(id, {
        operator: { providers: {} },
        workspace: { providers: { [id]: { mode: "off", models: [] } } },
      })).toEqual({ allowed: false, reason: `${label} is turned off for this workspace.`, level: "workspace" });
      expect(resolveProvider(id, {
        operator: { providers: {} },
        workspace: { providers: { [id]: { mode: "bundled", models: ["m1", "m2"] } } },
      })).toEqual({ allowed: true, mode: "bundled", models: ["m1", "m2"] });
      expect(resolveProvider(id, {
        operator: { providers: {} },
        workspace: { providers: { [id]: { mode: "byo", models: [] } } },
      })).toEqual({ allowed: true, mode: "byo" });
      // Level 3 (bot): per-instance and per-model enforcement follow the same verdict.
      for (const instanceId of PROVIDER_INSTANCES[id]) {
        expect(switchboardInstanceRefusal(instanceId, {
          operator: { providers: { [id]: { enabled: false } } },
          workspace: { providers: {} },
        })).toBe(`${label} is turned off by the operator.`);
        expect(switchboardSelectionRefusal({ instanceId, model: "m1" }, {
          operator: { providers: {} },
          workspace: { providers: { [id]: { mode: "bundled", models: ["m1"] } } },
        })).toBeUndefined();
        expect(switchboardSelectionRefusal({ instanceId, model: "other" }, {
          operator: { providers: {} },
          workspace: { providers: { [id]: { mode: "bundled", models: ["m1"] } } },
        })).toBe(`This model is not assigned to this workspace. Choose one of its ${label} models.`);
      }
    }
  });

  it("grants nothing to unknown provider ids and leaves unknown instances alone", () => {
    expect(isKnownProviderId("openai")).toBe(false);
    expect(resolveProvider("openai")).toEqual({ allowed: false, reason: 'Unknown provider "openai".' });
    expect(resolveProvider("")).toEqual({ allowed: false, reason: 'Unknown provider "".' });
    expect(instanceProvider("openaiCompat")).toBeNull();
    expect(switchboardInstanceRefusal("openaiCompat")).toBeUndefined();
    expect(switchboardSelectionRefusal({ instanceId: "openaiCompat", model: "anything" })).toBeUndefined();
    // Unknown ids in policies are ignored, never granted.
    expect(resolveProvider("claude", {
      operator: { providers: { openai: { enabled: false } } as never },
      workspace: { providers: { openai: { mode: "bundled", models: ["m"] } } as never },
    })).toEqual({ allowed: true, mode: "byo" });
  });

  it("reads the operator kill-switch from the environment", () => {
    process.env.MAXIMUS_OPERATOR_PROVIDERS = JSON.stringify({ kimi: { enabled: false }, muse: { enabled: true } });
    expect(switchboardInstanceRefusal("kimi")).toBe("Kimi is turned off by the operator.");
    expect(switchboardInstanceRefusal("museCode")).toBeUndefined();
    expect(switchboardInstanceRefusal("claude")).toBeUndefined();
  });

  it("reads the workspace policy from the environment", () => {
    process.env.MAXIMUS_WORKSPACE_PROVIDERS = JSON.stringify({
      kimi: { mode: "bundled", models: ["kimi-k3.1-pro"] },
      muse: { mode: "off" },
    });
    expect(switchboardSelectionRefusal({ instanceId: "kimiApi", model: "kimi-k3.1-pro" })).toBeUndefined();
    expect(switchboardSelectionRefusal({ instanceId: "kimiApi", model: "kimi-k3" }))
      .toBe("This model is not assigned to this workspace. Choose one of its Kimi models.");
    expect(switchboardInstanceRefusal("meta")).toBe("Muse is turned off for this workspace.");
    expect(switchboardInstanceRefusal("museCode")).toBe("Muse is turned off for this workspace.");
  });

  it("fails closed on invalid configuration, with a reason naming the fix", () => {
    process.env.MAXIMUS_OPERATOR_PROVIDERS = "{not json";
    expect(switchboardInstanceRefusal("claude")).toContain("MAXIMUS_OPERATOR_PROVIDERS must be a JSON object");
    process.env.MAXIMUS_OPERATOR_PROVIDERS = JSON.stringify({ kimi: { enabled: "no" } });
    expect(switchboardInstanceRefusal("kimi")).toContain('invalid operator configuration for "kimi"');
    expect(switchboardInstanceRefusal("claude")).toBeUndefined();
    delete process.env.MAXIMUS_OPERATOR_PROVIDERS;
    process.env.MAXIMUS_WORKSPACE_PROVIDERS = "[1,2]";
    expect(switchboardInstanceRefusal("claude")).toContain("MAXIMUS_WORKSPACE_PROVIDERS must be a JSON object");
    process.env.MAXIMUS_WORKSPACE_PROVIDERS = JSON.stringify({ kimi: { mode: "sometimes" } });
    expect(switchboardInstanceRefusal("kimi")).toContain('invalid workspace configuration for "kimi"');
    process.env.MAXIMUS_WORKSPACE_PROVIDERS = JSON.stringify({ kimi: { mode: "bundled" } });
    expect(switchboardInstanceRefusal("kimi")).toContain('invalid workspace configuration for "kimi"');
  });

  it("refuses bundled providers with no assigned models", () => {
    expect(switchboardInstanceRefusal("kimi", {
      operator: { providers: {} },
      workspace: { providers: { kimi: { mode: "bundled", models: [] } } },
    })).toBe("No Kimi models are assigned to this workspace. Ask your administrator to enable model access in Admin.");
  });

  it("governs instance ids the default fleet actually ships", () => {
    // A fleet rename must update PROVIDER_INSTANCES too, or the switchboard silently stops governing the renamed engine.
    const fleet = new Set(Object.keys(DEFAULT_FLEET));
    for (const id of PROVIDER_IDS) {
      expect(PROVIDER_INSTANCES[id].length).toBeGreaterThan(0);
      for (const instanceId of PROVIDER_INSTANCES[id]) {
        expect(fleet.has(instanceId), `switchboard governs "${instanceId}" but the default fleet no longer ships it`).toBe(true);
      }
    }
  });
});
