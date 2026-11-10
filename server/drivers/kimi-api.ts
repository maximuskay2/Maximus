import { z } from "zod";
import type { ModelCatalog, ProviderDriver } from "../contracts.ts";
import { createOpenAIChatRuntime } from "./openai-chat.ts";

// Kimi Model API over the OpenAI chat contract (Moonshot AI).
// Chat Completions: https://platform.kimi.ai/docs/api/chat.md
// Responses: https://platform.kimi.ai/docs/api/responses.md
// Messages (Anthropic-compatible): https://platform.kimi.ai/docs/api/messages.md
const DEFAULT_URL = "https://api.moonshot.ai/v1";
// Pinned from https://platform.kimi.ai/docs/models.md (verified 2026-11-07):
// kimi-k3.1-pro is the flagship (default), kimi-k3.1-pro-highspeed the ~2-3x
// faster variant, kimi-k3 the previous flagship. All three state a 1M-token
// context window. k2.x ids are deprecated and intentionally not listed.
const KIMI_CONTEXT_WINDOW = 1_000_000;
const DEFAULT_MODELS: ModelCatalog = {
  default: "kimi-k3.1-pro",
  options: [
    { id: "kimi-k3.1-pro", label: "Kimi K3.1 Pro", contextWindow: KIMI_CONTEXT_WINDOW },
    { id: "kimi-k3.1-pro-highspeed", label: "Kimi K3.1 Pro Highspeed", contextWindow: KIMI_CONTEXT_WINDOW },
    { id: "kimi-k3", label: "Kimi K3", contextWindow: KIMI_CONTEXT_WINDOW },
  ],
};
const configSchema = z.object({
  url: z.string().trim().url().default(DEFAULT_URL),
  model: z.string().trim().min(1).optional(),
  tools: z.boolean().optional(),
});
type KimiApiConfig = z.output<typeof configSchema>;

function decodeConfig(raw: unknown): KimiApiConfig {
  const config = configSchema.parse(raw ?? {});
  config.url = config.url.replace(/\/+$/, "");
  const url = new URL(config.url);
  if (url.protocol !== "https:" && !(url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Kimi requires HTTPS, except for a local test endpoint.");
  }
  return config;
}

const modelCard = z.object({
  id: z.string().trim().min(1),
  context_window: z.number().int().positive().optional(),
});

function kimiLabel(id: string): string {
  if (!/^kimi-/i.test(id)) return id;
  return id.split("-").map(word => /^\d/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export const KimiApiDriver: ProviderDriver<KimiApiConfig> = {
  driverKind: "kimiApi",
  metadata: { displayName: "Kimi (API)", supportsMultipleInstances: true, access: "api" },
  models: DEFAULT_MODELS,
  install: {
    docsUrl: "https://platform.kimi.ai/docs/",
    settings: "connections",
    signInCommand: "Save a Kimi API key in Settings → API keys, or set MOONSHOT_API_KEY on the server.",
  },
  decodeConfig,
  defaultConfig: () => decodeConfig({}),
  async create(input) {
    const { config } = input;
      // A custom host must bring its own credential; the workspace key goes only to its configured endpoint.
    const apiKey = (input.environment.MOONSHOT_API_KEY ??
      (config.url === DEFAULT_URL ? process.env.MOONSHOT_API_KEY : undefined) ?? "").trim();
    const known = new Map(DEFAULT_MODELS.options.map(option => [option.id, option]));
    const withConfiguredModel = (options: ModelCatalog["options"]): ModelCatalog => {
      const preferred = config.model ?? DEFAULT_MODELS.default;
      if (config.model && !options.some(option => option.id === config.model)) {
        options = [{ id: config.model, label: kimiLabel(config.model) }, ...options];
      }
      return { default: options.some(option => option.id === preferred) ? preferred : options[0].id, options };
    };
    let catalog = withConfiguredModel(DEFAULT_MODELS.options);
    const refreshModels = async () => {
      if (!apiKey) return;
      try {
        const response = await fetch(`${config.url}/models`, {
          headers: { authorization: `Bearer ${apiKey}` }, redirect: "error",
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) return;
        const rows = z.object({ data: z.array(z.unknown()) }).parse(await response.json()).data;
        const options: ModelCatalog["options"] = [];
        const seen = new Set<string>();
        for (const row of rows) {
          const parsed = modelCard.safeParse(row);
          if (!parsed.success || seen.has(parsed.data.id)) continue;
          const { id, context_window } = parsed.data;
          seen.add(id);
          options.push({ ...(known.get(id) ?? { id, label: kimiLabel(id) }), ...(context_window ? { contextWindow: context_window } : {}) });
        }
        if (options.length) catalog = withConfiguredModel(options);
      } catch {}
    };
    if (apiKey) void refreshModels();
    return createOpenAIChatRuntime({
      input, driverKind: "kimiApi", apiKey, apiUrl: config.url,
      tools: config.tools, models: () => catalog, refreshModels, reasoning: true,
      computerUse: true,
      requestBody: (model, messages, stream) => ({
        model, messages, stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      }),
      httpErrorLabel: "Kimi",
      missingKeyError: "Save a Kimi API key in Settings → API keys, or set MOONSHOT_API_KEY.",
      unavailableReason: "No Kimi API key — open Settings → API keys.",
      // Kimi streams, but reasoning plus long generations needs more headroom than the 180s default.
      timeoutMs: 300_000, billing: "metered", includeUsageInCompleted: true,
      nativeLog: {
        source: "kimi.chat.completions",
        outgoing: (_turn, messages, model) => ({ model, messageCount: messages.length }),
        incoming: ({ text, reasoning, usage }) => ({ textLength: text.length, reasoningLength: reasoning.length, usage }),
      },
    });
  },
};
