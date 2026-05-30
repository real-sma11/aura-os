import { describe, expect, it } from "vitest";

import {
  LLM_MARKUP_MULTIPLIER,
  computeSessionCost,
  getBilledPricing,
  normalizePricingKey,
  resolvePricing,
} from "./model-pricing";

describe("normalizePricingKey", () => {
  it("maps aura-managed ids to provider pricing keys", () => {
    expect(normalizePricingKey("aura-claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(normalizePricingKey("aura-gpt-5-5")).toBe("gpt-5.5");
    expect(normalizePricingKey("aura-gpt-5-4-mini")).toBe("gpt-5.4-mini");
    expect(normalizePricingKey("aura-kimi-k2-6")).toBe("kimi-k2p6");
    expect(normalizePricingKey("aura-deepseek-v4-pro")).toBe("deepseek-v4-pro");
  });
});

describe("getBilledPricing", () => {
  it("applies the 20% markup to base rates", () => {
    const base = resolvePricing("aura-claude-opus-4-8");
    const billed = getBilledPricing("aura-claude-opus-4-8");
    expect(billed.input).toBeCloseTo(base.input * LLM_MARKUP_MULTIPLIER, 6);
    expect(billed.output).toBeCloseTo(5 * 1.2 * 5, 6); // base output 25 -> 30
    expect(billed.cacheRead).toBeCloseTo(0.5 * 1.2, 6);
  });
});

describe("computeSessionCost", () => {
  it("computes total billed cost and weighted average per million", () => {
    const result = computeSessionCost({
      model: "aura-claude-opus-4-8",
      provider: "anthropic",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    // billed input $6/M, output $30/M -> $36 total over 2M tokens.
    expect(result.totalCostUsd).toBeCloseTo(36, 6);
    expect(result.totalTokens).toBe(2_000_000);
    expect(result.avgCostPerMillionUsd).toBeCloseTo(18, 6);
    expect(result.unknown).toBe(false);
  });

  it("flags unknown pricing for unrecognized models", () => {
    const result = computeSessionCost({
      model: "totally-made-up-model",
      inputTokens: 1000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(result.unknown).toBe(true);
    expect(result.totalCostUsd).toBe(0);
  });

  it("returns zero average when no tokens consumed", () => {
    const result = computeSessionCost({
      model: "aura-gpt-5-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(result.avgCostPerMillionUsd).toBe(0);
  });
});
