/**
 * Per-model LLM pricing used by the Context popover's "Session Cost"
 * section. Rates are the base provider prices in USD per million tokens,
 * ported from `interface/scripts/lib/benchmark-pricing.mjs` (which in
 * turn mirrors the rates in `aura-router`'s `billing.rs`).
 *
 * Displayed/charged cost applies {@link LLM_MARKUP_MULTIPLIER}, matching
 * `DEFAULT_LLM_MARKUP_MULTIPLIER` in aura-router so the figures line up
 * with what is actually debited as Z credits (1 Z = $0.01).
 *
 * This module is pure (no side effects) and lives at the constants layer:
 * it must not import from `features` or `apps`.
 */

/** Markup applied on top of base provider rates (matches aura-router). */
export const LLM_MARKUP_MULTIPLIER = 1.2;

/** 1 Z credit in US dollars. */
export const USD_PER_Z = 0.01;

export type PricingProvider =
  | "anthropic"
  | "openai"
  | "fireworks"
  | "deepseek"
  | "unknown";

/** Base provider rates, USD per 1M tokens. */
export interface ModelRates {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
}

/** Rates resolved for a model, including which table they came from. */
export interface ResolvedPricing extends ModelRates {
  readonly provider: PricingProvider;
  readonly model: string;
  readonly source: string;
}

/** Cumulative token counts for a session, used to compute cost. */
export interface SessionTokenUsage {
  readonly model: string;
  readonly provider?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
}

const ANTHROPIC_PRICING: Readonly<Record<string, ModelRates>> = {
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-7": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-1": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-opus-4": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
} as const;

const OPENAI_PRICING: Readonly<Record<string, ModelRates>> = {
  "gpt-5.5": { input: 5, output: 30, cacheWrite: 5, cacheRead: 0.5 },
  "gpt-5.4": { input: 2.5, output: 15, cacheWrite: 2.5, cacheRead: 0.25 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5, cacheWrite: 0.75, cacheRead: 0.075 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25, cacheWrite: 0.2, cacheRead: 0.02 },
} as const;

const FIREWORKS_PRICING: Readonly<Record<string, ModelRates>> = {
  "kimi-k2p6": { input: 0.95, output: 4.0, cacheWrite: 0.95, cacheRead: 0.16 },
  "kimi-k2p5": { input: 0.6, output: 3.0, cacheWrite: 0.6, cacheRead: 0.1 },
  "gpt-oss-120b": { input: 0.15, output: 0.6, cacheWrite: 0.15, cacheRead: 0.01 },
  "minimax-m2p7": { input: 0.3, output: 1.2, cacheWrite: 0.3, cacheRead: 0.06 },
  "glm-5p1": { input: 1.4, output: 4.4, cacheWrite: 1.4, cacheRead: 0.26 },
  "qwen3p6-plus": { input: 0.5, output: 3.0, cacheWrite: 0.5, cacheRead: 0.1 },
  // Gemma is tier-priced (uniform input/output, no cached-input discount).
  "gemma-4-31b-it": { input: 0.9, output: 0.9, cacheWrite: 0.9, cacheRead: 0.9 },
  "gemma-4-26b-a4b-it": { input: 0.5, output: 0.5, cacheWrite: 0.5, cacheRead: 0.5 },
} as const;

const DEEPSEEK_PRICING: Readonly<Record<string, ModelRates>> = {
  "deepseek-v4-pro": { input: 1.74, output: 3.48, cacheWrite: 1.74, cacheRead: 0.145 },
  "deepseek-v4-flash": { input: 0.14, output: 0.28, cacheWrite: 0.14, cacheRead: 0.028 },
} as const;

const PROVIDER_TABLES: Readonly<
  Record<Exclude<PricingProvider, "unknown">, Readonly<Record<string, ModelRates>>>
> = {
  anthropic: ANTHROPIC_PRICING,
  openai: OPENAI_PRICING,
  fireworks: FIREWORKS_PRICING,
  deepseek: DEEPSEEK_PRICING,
} as const;

const ZERO_RATES: ModelRates = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

/**
 * Normalize an Aura-managed model id to the provider's canonical pricing
 * key (e.g. `aura-claude-opus-4-8` -> `claude-opus-4-8`,
 * `aura-gpt-5-5` -> `gpt-5.5`, `aura-kimi-k2-6` -> `kimi-k2p6`).
 */
export function normalizePricingKey(model: string): string {
  const key = model.trim().toLowerCase();
  const directAura: Readonly<Record<string, string>> = {
    "aura-kimi-k2-6": "kimi-k2p6",
    "aura-kimi-k2-5": "kimi-k2p5",
    "aura-oss-120b": "gpt-oss-120b",
    "aura-deepseek-v4-pro": "deepseek-v4-pro",
    "aura-deepseek-v4-flash": "deepseek-v4-flash",
    "aura-minimax-m2-7": "minimax-m2p7",
    "aura-glm-5-1": "glm-5p1",
    "aura-qwen3-6-plus": "qwen3p6-plus",
    "aura-gemma-4-31b": "gemma-4-31b-it",
    "aura-gemma-4-26b-a4b": "gemma-4-26b-a4b-it",
  };
  if (directAura[key]) return directAura[key];
  const auraClaude = key.match(/^aura-(claude-.+)$/);
  if (auraClaude) return auraClaude[1];
  const auraGpt = key.match(/^aura-gpt-(\d+)-(\d+)(.*)$/);
  if (auraGpt) return `gpt-${auraGpt[1]}.${auraGpt[2]}${auraGpt[3]}`;
  return key;
}

function inferProvider(model: string, provider?: string): PricingProvider {
  const explicit = provider?.trim().toLowerCase();
  if (explicit === "anthropic" || explicit === "openai") return explicit;
  if (explicit === "fireworks" || explicit === "deepseek") return explicit;
  const key = normalizePricingKey(model);
  if (key.startsWith("claude")) return "anthropic";
  if (key.startsWith("deepseek")) return "deepseek";
  if (
    key.startsWith("kimi") ||
    key.startsWith("gpt-oss") ||
    key.startsWith("minimax") ||
    key.startsWith("glm") ||
    key.startsWith("qwen") ||
    key.startsWith("gemma")
  ) {
    return "fireworks";
  }
  if (key.startsWith("gpt") || key.startsWith("o1") || key.startsWith("o3")) {
    return "openai";
  }
  return "unknown";
}

/** Resolve base ($/Mtok) rates for a model + optional provider hint. */
export function resolvePricing(model: string, provider?: string): ResolvedPricing {
  const resolvedProvider = inferProvider(model, provider);
  const key = normalizePricingKey(model);
  if (resolvedProvider !== "unknown") {
    const rates = PROVIDER_TABLES[resolvedProvider][key];
    if (rates) {
      return { provider: resolvedProvider, model: key, source: resolvedProvider, ...rates };
    }
  }
  return { provider: resolvedProvider, model: key, source: "unknown-pricing", ...ZERO_RATES };
}

/** Billed rates = base rates x {@link LLM_MARKUP_MULTIPLIER}. */
export function getBilledPricing(model: string, provider?: string): ResolvedPricing {
  const base = resolvePricing(model, provider);
  return {
    ...base,
    input: base.input * LLM_MARKUP_MULTIPLIER,
    output: base.output * LLM_MARKUP_MULTIPLIER,
    cacheWrite: base.cacheWrite * LLM_MARKUP_MULTIPLIER,
    cacheRead: base.cacheRead * LLM_MARKUP_MULTIPLIER,
  };
}

/** True when no rate is known for the model (unknown pricing). */
export function isUnknownPricing(pricing: ResolvedPricing): boolean {
  return (
    pricing.source === "unknown-pricing" ||
    (pricing.input === 0 && pricing.output === 0 && pricing.cacheRead === 0)
  );
}

export interface SessionCostBreakdown {
  readonly pricing: ResolvedPricing;
  readonly totalCostUsd: number;
  /** Token-count-weighted average billed cost, USD per 1M tokens. */
  readonly avgCostPerMillionUsd: number;
  readonly totalTokens: number;
  readonly unknown: boolean;
}

/**
 * Compute the billed session cost from cumulative token usage. Mirrors
 * `calculateEstimatedCostUsd` in benchmark-pricing.mjs, including its
 * DeepSeek handling where cache tokens are already counted in input.
 */
export function computeSessionCost(usage: SessionTokenUsage): SessionCostBreakdown {
  const pricing = getBilledPricing(usage.model, usage.provider);
  const cacheTokens = usage.cacheCreationTokens + usage.cacheReadTokens;
  const billedInputTokens =
    pricing.provider === "deepseek" && cacheTokens > 0
      ? Math.max(0, usage.inputTokens - cacheTokens)
      : usage.inputTokens;

  const totalCostUsd =
    (billedInputTokens / 1_000_000) * pricing.input +
    (usage.outputTokens / 1_000_000) * pricing.output +
    (usage.cacheCreationTokens / 1_000_000) * pricing.cacheWrite +
    (usage.cacheReadTokens / 1_000_000) * pricing.cacheRead;

  // Weighted average across the token types actually consumed.
  const totalTokens = usage.inputTokens + usage.outputTokens + cacheTokens;
  const avgCostPerMillionUsd = totalTokens > 0 ? (totalCostUsd / totalTokens) * 1_000_000 : 0;

  return {
    pricing,
    totalCostUsd,
    avgCostPerMillionUsd,
    totalTokens,
    unknown: isUnknownPricing(pricing),
  };
}
