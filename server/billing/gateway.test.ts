import { describe, expect, it } from "vitest";

import type { ProviderId, SwitchboardPolicies } from "../switchboard.ts";
import {
  assertNoOperatorKeys, assertNoUserCredentials, extractBearerToken, forwardBundledRequest, GATEWAY_TOKEN_PATTERN,
  parseGatewayRoute, routeTurn, stripUserCredentials, tokenStoreFromEnv, type GatewayTokenStore, type MeteredTurn,
} from "./gateway.ts";

const TOKEN = `maximus_workspace_${"a".repeat(43)}`;
const OTHER_TOKEN = `maximus_workspace_${"b".repeat(43)}`;
const OUR_KEY = "our-operator-key-never-leaves-the-gateway";

const tokens: GatewayTokenStore = { workspaceFor: (token) => token === TOKEN ? "acme" : null };
const catalog = (workspace: string, provider: ProviderId): string[] | null =>
  workspace === "acme" ? [`${provider}-model-1`, `${provider}-model-2`] : null;

interface Captured {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string };
}

const stubUpstream = (captured: Captured[], body = JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 50 } })) =>
  async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Response> => {
    captured.push({ url, init });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  };

describe("managed gateway", () => {
  it("parses gateway routes for all five providers and rejects the rest", () => {
    expect(parseGatewayRoute("/api/gateway/acme/codex/responses")).toEqual({ workspace: "acme", provider: "codex", upstreamPath: "/responses" });
    expect(parseGatewayRoute("/api/gateway/acme/muse/v1/messages")).toEqual({ workspace: "acme", provider: "muse", upstreamPath: "/v1/messages" });
    expect(parseGatewayRoute("/api/gateway/acme/kimi/v1/chat/completions")?.provider).toBe("kimi");
    expect(parseGatewayRoute("/api/gateway/Acme/codex/x")).toBeNull();
    expect(parseGatewayRoute("/api/gateway/acme/unknown/x")).toBeNull();
    expect(parseGatewayRoute("/api/gateway/acme/codex/../escape")).toBeNull();
    expect(parseGatewayRoute("/api/usage")).toBeNull();
  });

  it("authenticates the per-workspace token against the route workspace", async () => {
    expect(GATEWAY_TOKEN_PATTERN.test(TOKEN)).toBe(true);
    expect(extractBearerToken({ authorization: `Bearer ${TOKEN}` })).toBe(TOKEN);
    expect(extractBearerToken({})).toBeNull();
    const captured: Captured[] = [];
    const deps = { tokens, catalog, keys: () => OUR_KEY, fetchImpl: stubUpstream(captured) as typeof fetch, book: () => {} };
    const body = JSON.stringify({ model: "codex-model-1" });
    const headers = { authorization: `Bearer ${OTHER_TOKEN}` };
    const refused = await forwardBundledRequest({ method: "POST", path: "/api/gateway/acme/codex/v1/responses", headers, rawBody: body }, deps);
    expect(refused.status).toBe(401);
    const missing = await forwardBundledRequest({ method: "POST", path: "/api/gateway/acme/codex/v1/responses", headers: {}, rawBody: body }, deps);
    expect(missing.status).toBe(401);
    expect(captured).toHaveLength(0);
  });

  it("reads the token store from env and compares timing-safely", () => {
    const store = tokenStoreFromEnv({ MAXIMUS_GATEWAY_TOKENS: JSON.stringify({ acme: TOKEN }) });
    expect(store.workspaceFor(TOKEN)).toBe("acme");
    expect(store.workspaceFor(OTHER_TOKEN)).toBeNull();
    expect(store.workspaceFor("not-a-token")).toBeNull();
    expect(tokenStoreFromEnv({}).workspaceFor(TOKEN)).toBeNull();
    expect(tokenStoreFromEnv({ MAXIMUS_GATEWAY_TOKENS: "{broken" }).workspaceFor(TOKEN)).toBeNull();
  });

  it("enforces the assigned-model catalog at the gateway, not just the client", async () => {
    const captured: Captured[] = [];
    const deps = { tokens, catalog, keys: () => OUR_KEY, fetchImpl: stubUpstream(captured) as typeof fetch, book: () => {} };
    const headers = { authorization: `Bearer ${TOKEN}` };
    const unassigned = await forwardBundledRequest(
      { method: "POST", path: "/api/gateway/acme/codex/v1/responses", headers, rawBody: JSON.stringify({ model: "not-assigned" }) },
      deps,
    );
    expect(unassigned.status).toBe(403);
    expect(unassigned.body).toContain("not assigned to this workspace");
    const noCatalog = await forwardBundledRequest(
      { method: "POST", path: "/api/gateway/acme/codex/v1/responses", headers, rawBody: JSON.stringify({ model: "codex-model-1" }) },
      { ...deps, catalog: () => null },
    );
    expect(noCatalog.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  it("forwards with OUR provider key and meters the turn as bundled", async () => {
    const captured: Captured[] = [];
    const metered: MeteredTurn[] = [];
    const result = await forwardBundledRequest(
      {
        method: "POST",
        path: "/api/gateway/acme/codex/v1/responses",
        headers: { authorization: `Bearer ${TOKEN}`, "x-request-id": "req-1" },
        rawBody: JSON.stringify({ model: "codex-model-1" }),
      },
      { tokens, catalog, keys: () => OUR_KEY, fetchImpl: stubUpstream(captured) as typeof fetch, book: (turn) => metered.push(turn) },
    );
    expect(result.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe("https://api.openai.com/v1/v1/responses");
    expect(captured[0]?.init.headers?.authorization).toBe(`Bearer ${OUR_KEY}`);
    expect(captured[0]?.init.headers?.["x-request-id"]).toBe("req-1");
    expect(captured[0]?.init.body).toContain("codex-model-1");
    expect(metered).toEqual([{ workspace: "acme", provider: "codex", model: "codex-model-1", input: 100, output: 50 }]);
    expect(result.metered).toEqual(metered[0]);
  });

  it("reads Anthropic usage shapes and refuses at the hard cap without calling upstream", async () => {
    const captured: Captured[] = [];
    const metered: MeteredTurn[] = [];
    const anthropic = async (url: string, init: { headers?: Record<string, string> }): Promise<Response> => {
      captured.push({ url, init });
      expect(init.headers?.["x-api-key"]).toBe(OUR_KEY);
      return new Response(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 20 } }), { status: 200 });
    };
    const ok = await forwardBundledRequest(
      {
        method: "POST",
        path: "/api/gateway/acme/claude/v1/messages",
        headers: { authorization: `Bearer ${TOKEN}` },
        rawBody: JSON.stringify({ model: "claude-model-1" }),
      },
      { tokens, catalog, keys: () => OUR_KEY, fetchImpl: anthropic as typeof fetch, book: (turn) => metered.push(turn) },
    );
    expect(ok.status).toBe(200);
    expect(metered[0]).toMatchObject({ provider: "claude", input: 10, output: 20 });
    const capped = await forwardBundledRequest(
      {
        method: "POST",
        path: "/api/gateway/acme/claude/v1/messages",
        headers: { authorization: `Bearer ${TOKEN}` },
        rawBody: JSON.stringify({ model: "claude-model-1" }),
      },
      {
        tokens,
        catalog,
        keys: () => OUR_KEY,
        fetchImpl: anthropic as typeof fetch,
        budget: () => ({ month: "2026-11", allowanceUsd: 1, spentUsd: 9, overageUsd: 8, hardCapUsd: 9, percent: 900, withinAllowance: false, capExceeded: true }),
      },
    );
    expect(capped.status).toBe(409);
    expect(capped.body).toContain("spend_cap");
    expect(captured).toHaveLength(1);
  });

  it("keeps keys isolated in both directions", () => {
    // Direction 1: BYO credentials never reach the gateway.
    expect(() => assertNoUserCredentials({ authorization: `Bearer ${TOKEN}` }, TOKEN)).not.toThrow();
    expect(() => assertNoUserCredentials({ authorization: "Bearer sk-user-byo-key", "x-request-id": "r" }, TOKEN)).toThrow(/never sent to the managed gateway/);
    expect(() => assertNoUserCredentials({ "x-api-key": "user-key" }, TOKEN)).toThrow();
    const stripped = stripUserCredentials({ authorization: "Bearer x", "x-api-key": "y", cookie: "z", "x-request-id": "keep" });
    expect(stripped).toEqual({ "x-request-id": "keep" });
    // Direction 2: our gateway keys never reach a workspace.
    expect(() => assertNoOperatorKeys({})).not.toThrow();
    expect(() => assertNoOperatorKeys({ MAXIMUS_GATEWAY_OPENAI_KEY: "sk-live" })).toThrow(/never reach a workspace/);
  });

  it("rejects requests smuggling user credentials past the token", async () => {
    const captured: Captured[] = [];
    const result = await forwardBundledRequest(
      {
        method: "POST",
        path: "/api/gateway/acme/codex/v1/responses",
        headers: { authorization: `Bearer ${TOKEN}`, "x-api-key": "sk-user-byo-key" },
        rawBody: JSON.stringify({ model: "codex-model-1" }),
      },
      { tokens, catalog, keys: () => OUR_KEY, fetchImpl: stubUpstream(captured) as typeof fetch },
    );
    expect(result.status).toBe(400);
    expect(result.body).toContain("gateway_isolation");
    expect(captured).toHaveLength(0);
  });

  it("routes each provider independently: mixed BYO + bundled in one workspace", () => {
    const policies: SwitchboardPolicies = {
      operator: { providers: {} },
      workspace: {
        providers: {
          claude: { mode: "byo", models: [] },
          kimi: { mode: "bundled", models: ["kimi-k3.1-pro"] },
          muse: { mode: "off", models: [] },
        },
      },
    };
    expect(routeTurn({ instanceId: "claude", model: "anything" }, { policies, gatewayEntitled: true })).toEqual({ via: "byo" });
    expect(routeTurn({ instanceId: "kimi", model: "kimi-k3.1-pro" }, { policies, gatewayEntitled: true }))
      .toEqual({ via: "bundled", models: ["kimi-k3.1-pro"] });
    expect(routeTurn({ instanceId: "kimi", model: "not-assigned" }, { policies, gatewayEntitled: true }).via).toBe("refused");
    expect(routeTurn({ instanceId: "meta", model: "muse-spark-1.3" }, { policies, gatewayEntitled: true })).toMatchObject({ via: "refused" });
    // Bundled without the gateway entitlement refuses instead of routing.
    expect(routeTurn({ instanceId: "kimi", model: "kimi-k3.1-pro" }, { policies, gatewayEntitled: false }).via).toBe("refused");
    // Instances outside the switchboard keep today's behavior: direct, untouched.
    expect(routeTurn({ instanceId: "opencode", model: "anything" }, { policies })).toEqual({ via: "byo" });
  });
});
