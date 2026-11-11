import { describe, expect, it } from "vitest";

import { BOX_DENY_ENV } from "./bot-box/boot.ts";
import { boxEnvironment } from "./bot-box/env.ts";
import {
  assertNoOperatorKeys, forwardBundledRequest, GATEWAY_KEY_ENVS, stripUserCredentials,
  type GatewayTokenStore, type MeteredTurn,
} from "./billing/gateway.ts";
import { CONTROL_PLANE_ENV, stripControlPlaneEnv, stripWorkspaceCredentialEnv } from "./credential-env.ts";
import type { ProviderId } from "./switchboard.ts";

const TOKEN = `maximus_workspace_${"k".repeat(43)}`;
const OUR_KEY = "our-operator-key-never-leaves-the-gateway";
const PERSON_KEY = "person-moonshot-key-never-reaches-the-gateway";
const GATEWAY_TOKENS = "MAXIMUS_GATEWAY_TOKENS";

const tokens: GatewayTokenStore = { workspaceFor: (token) => token === TOKEN ? "acme" : null };
const catalog = (workspace: string, provider: ProviderId): string[] | null =>
  workspace === "acme" ? [`${provider}-model-1`] : null;

describe("key split", () => {
  it("denies every gateway operator key to engine children, whatever Tosin's key table holds", () => {
    const operator = Object.fromEntries([...GATEWAY_KEY_ENVS, GATEWAY_TOKENS].map((name) => [name, OUR_KEY]));
    for (const name of Object.keys(operator)) {
      expect([...CONTROL_PLANE_ENV], `${name} must be an operator-only secret`).toContain(name);
      expect(BOX_DENY_ENV.has(name), `${name} must be denied to the bot box`).toBe(true);
    }
    expect(boxEnvironment({ PATH: "/usr/bin", ...operator })).toEqual({ PATH: "/usr/bin" });
  });

  it("leaves a BYO engine its person's key and no gateway key", () => {
    const dirty: Record<string, string | undefined> = {
      MOONSHOT_API_KEY: PERSON_KEY,
      META_API_KEY: "person-meta-key",
      ANTHROPIC_API_KEY: "person-anthropic-key",
      PATH: "/usr/bin",
      ...Object.fromEntries(GATEWAY_KEY_ENVS.map((name) => [name, OUR_KEY])),
      [GATEWAY_TOKENS]: JSON.stringify({ acme: TOKEN }),
    };
    expect(() => assertNoOperatorKeys(dirty)).toThrow(/never reach a workspace/);
    for (const strip of [stripControlPlaneEnv, stripWorkspaceCredentialEnv]) {
      const child: Record<string, string | undefined> = { ...dirty, maximus_gateway_openai_key: OUR_KEY };
      strip(child);
      expect(child.MOONSHOT_API_KEY).toBe(PERSON_KEY);
      expect(child.META_API_KEY).toBe("person-meta-key");
      expect(child.ANTHROPIC_API_KEY).toBe("person-anthropic-key");
      expect(child.PATH).toBe("/usr/bin");
      for (const name of [...GATEWAY_KEY_ENVS, GATEWAY_TOKENS, "maximus_gateway_openai_key"]) {
        expect(name in child, `${name} leaked to the engine`).toBe(false);
      }
      expect(() => assertNoOperatorKeys(child)).not.toThrow();
    }
  });

  it("sends a bundled turn upstream with the gateway key and none of the person's keys", async () => {
    const captured: Array<{ url: string; init: { headers?: Record<string, string>; body?: string } }> = [];
    const fetchImpl = (async (url: string, init: { headers?: Record<string, string>; body?: string }) => {
      captured.push({ url, init });
      return new Response(JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    }) as typeof fetch;
    const metered: MeteredTurn[] = [];
    const result = await forwardBundledRequest(
      {
        method: "POST",
        path: "/api/gateway/acme/kimi/v1/chat/completions",
        headers: { authorization: `Bearer ${TOKEN}` },
        rawBody: JSON.stringify({ model: "kimi-model-1" }),
      },
      { tokens, catalog, keys: () => OUR_KEY, fetchImpl, book: (turn) => metered.push(turn) },
    );
    expect(result.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.init.headers?.authorization).toBe(`Bearer ${OUR_KEY}`);
    expect(JSON.stringify(captured[0])).not.toContain(PERSON_KEY);
    expect(JSON.stringify(captured[0])).not.toContain(TOKEN);
    expect(metered).toEqual([{ workspace: "acme", provider: "kimi", model: "kimi-model-1", input: 10, output: 5 }]);
  });

  it("refuses a bundled request smuggling a person key before calling upstream", async () => {
    expect(stripUserCredentials({ authorization: `Bearer ${TOKEN}`, "x-api-key": PERSON_KEY, cookie: "s=1", "x-request-id": "keep" }))
      .toEqual({ "x-request-id": "keep" });
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const result = await forwardBundledRequest(
      {
        method: "POST",
        path: "/api/gateway/acme/kimi/v1/chat/completions",
        headers: { authorization: `Bearer ${TOKEN}`, "x-api-key": PERSON_KEY },
        rawBody: JSON.stringify({ model: "kimi-model-1" }),
      },
      { tokens, catalog, keys: () => OUR_KEY, fetchImpl },
    );
    expect(result.status).toBe(400);
    expect(result.body).toContain("gateway_isolation");
    expect(calls).toBe(0);
  });
});
