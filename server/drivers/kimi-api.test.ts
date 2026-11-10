import { createServer, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderInstance } from "../contracts.ts";
import { recordEvents } from "../testing/events.ts";
import { KimiApiDriver } from "./kimi-api.ts";

type ChatBody = { model: string; messages: Array<Record<string, unknown>>; tools?: unknown[]; stream_options?: unknown };
const fixtureKey = "kimi-fixture-key";
const stream = (res: ServerResponse, chunks: unknown[]) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n");
};

describe("Kimi API provider", () => {
  let server: Server;
  let base: string;
  let models: unknown;
  let reply: (body: ChatBody, res: ServerResponse) => void;
  let requests: Array<{ path: string; authorization?: string; body?: ChatBody }>;
  let instances: ProviderInstance[];

  beforeEach(async () => {
    vi.stubEnv("MOONSHOT_API_KEY", "");
    requests = [];
    instances = [];
    models = { data: [{ id: "kimi-k3.1-pro" }] };
    reply = (_body, res) => stream(res, [{ choices: [{ delta: { content: "Hello." }, finish_reason: "stop" }] }]);
    server = createServer(async (req, res) => {
      const request = { path: req.url ?? "", authorization: req.headers.authorization, body: undefined as ChatBody | undefined };
      requests.push(request);
      if (request.path.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(models));
        return;
      }
      let text = "";
      for await (const chunk of req) text += chunk;
      request.body = JSON.parse(text) as ChatBody;
      reply(request.body, res);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture provider address missing");
    base = `http://127.0.0.1:${address.port}/v1`;
  });

  afterEach(async () => {
    await Promise.all(instances.map(instance => instance.dispose()));
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.unstubAllEnvs();
  });

  const create = async (config = {}, environment = { MOONSHOT_API_KEY: fixtureKey }) => {
    const instance = await KimiApiDriver.create({ instanceId: "kimi-fixture", displayName: "Kimi", enabled: true,
      config: KimiApiDriver.decodeConfig(config), environment });
    instances.push(instance);
    return instance;
  };

  it("pins Moonshot's endpoint and catalog, and rejects unsafe configuration", async () => {
    expect(KimiApiDriver.defaultConfig().url).toBe("https://api.moonshot.ai/v1");
    expect(KimiApiDriver.models).toEqual({ default: "kimi-k3.1-pro", options: [
      { id: "kimi-k3.1-pro", label: "Kimi K3.1 Pro", contextWindow: 1_000_000 },
      { id: "kimi-k3.1-pro-highspeed", label: "Kimi K3.1 Pro Highspeed", contextWindow: 1_000_000 },
      { id: "kimi-k3", label: "Kimi K3", contextWindow: 1_000_000 },
    ] });
    expect(() => KimiApiDriver.decodeConfig({ url: "http://provider.example.test/v1" })).toThrow("HTTPS");
    expect(() => KimiApiDriver.decodeConfig({ tools: "false" })).toThrow();
    const instance = await create({ url: base }, { MOONSHOT_API_KEY: "" });
    const recorder = recordEvents(instance.adapter);
    try {
      expect(await instance.snapshot()).toMatchObject({ state: "unavailable", reason: expect.stringContaining("Kimi API key") });
      await expect(instance.adapter.sendTurn({ threadId: "missing", text: "Hello" })).rejects.toThrow("Kimi API key");
      expect(requests).toHaveLength(0);
    } finally { recorder.stop(); }
  });

  it("does not send the server's Kimi key to a custom instance host", async () => {
    vi.stubEnv("MOONSHOT_API_KEY", fixtureKey);
    const instance = await create({ url: base }, { MOONSHOT_API_KEY: "" });
    await instance.refreshModels?.();
    expect(await instance.snapshot()).toMatchObject({ state: "unavailable" });
    expect(requests).toHaveLength(0);
  });

  it("refreshes the catalog from the provider and keeps pinned labels", async () => {
    models = { data: [{ id: "kimi-k3.1-pro" }, { id: "kimi-k3" }, { id: "kimi-k3" }, null, { id: " " }] };
    const instance = await create({ url: base });
    await instance.refreshModels?.();
    expect(instance.models).toEqual({ default: "kimi-k3.1-pro", options: [
      { id: "kimi-k3.1-pro", label: "Kimi K3.1 Pro", contextWindow: 1_000_000 },
      { id: "kimi-k3", label: "Kimi K3", contextWindow: 1_000_000 },
    ] });
    expect(requests.every(request => request.path === "/v1/models" && request.authorization === `Bearer ${fixtureKey}`)).toBe(true);
  });

  it("streams the selected model and reports usage", async () => {
    reply = (_body, res) => stream(res, [
      { choices: [{ delta: { content: "Hello." }, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 14, completion_tokens: 4 } },
    ]);
    const instance = await create({ url: base });
    const recorder = recordEvents(instance.adapter);
    try {
      await instance.adapter.sendTurn({ threadId: "stream", text: "Hello", model: "kimi-k3" });
      expect(await recorder.until(event => event.type === "turn.completed")).toMatchObject({ ok: true, usage: { input: 14, output: 4 } });
      expect(instance.adapter.provider).toBe("kimiApi");
      const request = requests.find(request => request.path.endsWith("/chat/completions"))!;
      expect(request.authorization).toBe(`Bearer ${fixtureKey}`);
      expect(request.body).toMatchObject({ model: "kimi-k3", stream: true, stream_options: { include_usage: true } });
    } finally { recorder.stop(); }
  });
});
