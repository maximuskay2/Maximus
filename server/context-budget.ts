import type { ModelCatalog } from "./contracts.ts";
import { modelContextWindow } from "./model-context-window.ts";

export const DEFAULT_CONTEXT_WINDOW = 128_000;
const positive = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function contextWindowFor(model: string | undefined, catalog?: ModelCatalog, reported?: number): number {
  if (positive(reported)) return reported;
  const declared = catalog?.options.find((option) => option.id === model)?.contextWindow;
  if (positive(declared)) return declared;
  const inferred = model ? modelContextWindow(model) : undefined;
  return positive(inferred) ? inferred : DEFAULT_CONTEXT_WINDOW;
}

/** A "meter" reading (an ACP agent's own usage_update) is shown only; it never times Maximus's compaction. */
export function compactionReading<T>(capabilities: { contextReading?: "meter" } | undefined, reading: T | undefined): T | undefined {
  return capabilities?.contextReading === "meter" ? undefined : reading;
}

/** Above this, 80% of the window never folds in practice (Muse reports ~1M), so turns stay large and slow. */
const LARGE_WINDOW = 200_000;
/** Default fold target for those windows when the operator did not set `context.compactAt`. */
const LARGE_WINDOW_COMPACT_AT = 32_000;

/** Leave headroom even for a small local model: an 8k floor would make compaction unreachable on an 8k window. */
export function compactBudget(window: number, compactAt?: number, nativeCompactAt?: number): number {
  if (!positive(window)) throw new Error("invalid model context window");
  const unsetDefault = window > LARGE_WINDOW ? Math.min(window * 0.8, LARGE_WINDOW_COMPACT_AT) : window * 0.8;
  const configured = positive(compactAt) ? (compactAt < 1 ? window * compactAt : compactAt) : unsetDefault;
  return Math.max(1, Math.floor(Math.min(configured, window * 0.9, positive(nativeCompactAt) ? nativeCompactAt * 0.9 : Infinity)));
}

export function shouldCompact(input: { contextTokens?: number; estimatedBytes: number; budget: number; floor?: number; window: number; nativeCompactAt?: number }): boolean {
  // Summed input across tool rounds is NOT a context-window measurement.
  const size = positive(input.contextTokens) ? input.contextTokens : Math.ceil(input.estimatedBytes / 4);
  // Regrowth avoids refolding an irreducible prompt but never passes a known provider-native compaction boundary.
  const ceiling = compactBudget(input.window, input.window, input.nativeCompactAt);
  const threshold = Math.min(ceiling, positive(input.floor) ? Math.max(input.budget, input.floor * 1.25) : input.budget);
  return size >= threshold;
}
