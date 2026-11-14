const PROVIDERS = new Set([
  "openai", "openaiCompat", "openrouter", "anthropic", "xai", "mistral", "cerebras",
  "groq", "greenference", "meta", "kimi", "deepseek", "opencodeGo",
]);

const MAX_KEY_LENGTH = 2000;

function oneSecret(value: unknown, field: "key" | "apiKey"): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const names = Object.keys(record);
  const secret = record[field];
  return names.length === 1
    && names[0] === field
    && typeof secret === "string"
    && secret.trim().length > 0
    && secret.length <= MAX_KEY_LENGTH
    && !/[\r\n]/.test(secret);
}

/** A provider-key save and nothing else: no URLs, no sign-in list, no other settings. */
export function isProviderKeyPatch(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const entries = Object.entries(body as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every(([provider, value]) => {
    if (!PROVIDERS.has(provider)) return false;
    return oneSecret(value, provider === "opencodeGo" ? "apiKey" : "key");
  });
}
