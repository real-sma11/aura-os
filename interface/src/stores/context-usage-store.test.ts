import { beforeEach, describe, expect, it } from "vitest";
import {
  approxTokensFromText,
  mapWireContextBreakdown,
  useContextUsageStore,
} from "./context-usage-store";

describe("useContextUsageStore", () => {
  beforeEach(() => {
    useContextUsageStore.setState({
      usageByStreamKey: {},
      utilPerTokenByStreamKey: {},
      resetPendingByStreamKey: {},
    });
  });

  it("stores and retrieves a per-streamKey value", () => {
    useContextUsageStore.getState().setContextUtilization("k1", 0.42);
    const entry = useContextUsageStore.getState().usageByStreamKey.k1;
    expect(entry?.utilization).toBeCloseTo(0.42);
    expect(entry?.estimatedTokens).toBeUndefined();
  });

  it("stores an optional estimatedTokens alongside utilization", () => {
    useContextUsageStore.getState().setContextUtilization("k1", 0.42, 12_345);
    const entry = useContextUsageStore.getState().usageByStreamKey.k1;
    expect(entry?.utilization).toBeCloseTo(0.42);
    expect(entry?.estimatedTokens).toBe(12_345);
  });

  it("ignores non-finite or negative estimatedTokens", () => {
    const s = useContextUsageStore.getState();
    s.setContextUtilization("k1", 0.1, Number.NaN);
    s.setContextUtilization("k2", 0.2, -5);
    const latest = useContextUsageStore.getState();
    expect(latest.usageByStreamKey.k1?.estimatedTokens).toBeUndefined();
    expect(latest.usageByStreamKey.k2?.estimatedTokens).toBeUndefined();
  });

  it("clears a value without affecting reset-pending sentinel", () => {
    const s = useContextUsageStore.getState();
    s.setContextUtilization("k1", 0.42);
    s.markResetPending("k1");
    s.clearContextUtilization("k1");

    const latest = useContextUsageStore.getState();
    expect(latest.usageByStreamKey.k1).toBeUndefined();
    expect(latest.isResetPending("k1")).toBe(true);
  });

  it("markResetPending sets the sentinel; isResetPending reports it", () => {
    const s = useContextUsageStore.getState();
    expect(s.isResetPending("k1")).toBe(false);
    s.markResetPending("k1");
    expect(useContextUsageStore.getState().isResetPending("k1")).toBe(true);
  });

  it("setContextUtilization clears the reset-pending sentinel for that key", () => {
    const s = useContextUsageStore.getState();
    s.markResetPending("k1");
    s.markResetPending("k2");
    s.setContextUtilization("k1", 0.1);

    const latest = useContextUsageStore.getState();
    expect(latest.isResetPending("k1")).toBe(false);
    expect(latest.isResetPending("k2")).toBe(true);
  });

  it("bumpEstimatedTokens is a no-op before any ratio is known", () => {
    useContextUsageStore.getState().bumpEstimatedTokens("k1", 500);
    const entry = useContextUsageStore.getState().usageByStreamKey.k1;
    expect(entry?.estimatedTokens).toBe(500);
    // No prior utilization was set, so projected util is 0.
    expect(entry?.utilization).toBe(0);
  });

  it("bumpEstimatedTokens projects utilization using the cached ratio", () => {
    const s = useContextUsageStore.getState();
    // 10_000 tokens → 0.1 utilization implies a 100k window.
    s.setContextUtilization("k1", 0.1, 10_000);
    s.bumpEstimatedTokens("k1", 5_000);

    const entry = useContextUsageStore.getState().usageByStreamKey.k1;
    expect(entry?.estimatedTokens).toBe(15_000);
    expect(entry?.utilization).toBeCloseTo(0.15, 5);
  });

  it("bumpEstimatedTokens clamps projected utilization to 1 and never regresses", () => {
    const s = useContextUsageStore.getState();
    s.setContextUtilization("k1", 0.5, 50_000); // 100k window
    s.bumpEstimatedTokens("k1", 200_000);

    const entry = useContextUsageStore.getState().usageByStreamKey.k1;
    expect(entry?.utilization).toBe(1);
    // A further bump with a lower projection should not shrink the value.
    useContextUsageStore
      .getState()
      .setContextUtilization("k1", 0.9, 90_000);
    useContextUsageStore.getState().bumpEstimatedTokens("k1", 1_000);
    const latest = useContextUsageStore.getState().usageByStreamKey.k1;
    expect(latest?.utilization).toBeGreaterThanOrEqual(0.9);
  });

  it("bumpEstimatedTokens ignores zero / negative / NaN deltas", () => {
    const s = useContextUsageStore.getState();
    s.setContextUtilization("k1", 0.1, 100);
    s.bumpEstimatedTokens("k1", 0);
    s.bumpEstimatedTokens("k1", -50);
    s.bumpEstimatedTokens("k1", Number.NaN);
    const entry = useContextUsageStore.getState().usageByStreamKey.k1;
    expect(entry?.estimatedTokens).toBe(100);
  });

  it("clearContextUtilization also clears the cached ratio", () => {
    const s = useContextUsageStore.getState();
    s.setContextUtilization("k1", 0.4, 4_000);
    s.clearContextUtilization("k1");
    s.bumpEstimatedTokens("k1", 1_000);

    const entry = useContextUsageStore.getState().usageByStreamKey.k1;
    expect(entry?.estimatedTokens).toBe(1_000);
    // With the ratio cleared, utilization stays at 0 until a new
    // authoritative value arrives.
    expect(entry?.utilization).toBe(0);
  });

  it("approxTokensFromText is roughly 1 token per 4 chars", () => {
    expect(approxTokensFromText("")).toBe(0);
    expect(approxTokensFromText("abcd")).toBe(1);
    expect(approxTokensFromText("hello world!")).toBe(3);
  });

  it("stores an authoritative breakdown alongside utilization", () => {
    useContextUsageStore.getState().setContextUtilization("k1", 0.5, 100_000, {
      systemPromptTokens: 5_000,
      toolsTokens: 20_000,
      skillsTokens: 1_500,
      mcpTokens: 0,
      subagentsTokens: 800,
      conversationTokens: 72_700,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    const entry = useContextUsageStore.getState().usageByStreamKey.k1;
    expect(entry?.breakdown?.systemPromptTokens).toBe(5_000);
    expect(entry?.breakdown?.conversationTokens).toBe(72_700);
  });

  it("ignores an all-zero breakdown so the UI can fall back", () => {
    useContextUsageStore.getState().setContextUtilization("k1", 0.5, 100_000, {
      systemPromptTokens: 0,
      toolsTokens: 0,
      skillsTokens: 0,
      mcpTokens: 0,
      subagentsTokens: 0,
      conversationTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    const entry = useContextUsageStore.getState().usageByStreamKey.k1;
    expect(entry?.breakdown).toBeUndefined();
  });

  it("mapWireContextBreakdown returns undefined when the payload is missing", () => {
    expect(mapWireContextBreakdown(undefined)).toBeUndefined();
  });

  it("mapWireContextBreakdown rewrites snake_case fields into the camelCase store shape", () => {
    const mapped = mapWireContextBreakdown({
      system_prompt_tokens: 5_000,
      tools_tokens: 20_000,
      skills_tokens: 1_500,
      mcp_tokens: 0,
      subagents_tokens: 800,
      conversation_tokens: 72_700,
    });
    expect(mapped).toEqual({
      systemPromptTokens: 5_000,
      toolsTokens: 20_000,
      skillsTokens: 1_500,
      mcpTokens: 0,
      subagentsTokens: 800,
      conversationTokens: 72_700,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });

  it("mapWireContextBreakdown defaults missing snake fields to zero so a partial payload doesn't NaN", () => {
    expect(mapWireContextBreakdown({ conversation_tokens: 100 })).toEqual({
      systemPromptTokens: 0,
      toolsTokens: 0,
      skillsTokens: 0,
      mcpTokens: 0,
      subagentsTokens: 0,
      conversationTokens: 100,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });

  it("mapWireContextBreakdown carries cache_read/creation_tokens through to camelCase", () => {
    const mapped = mapWireContextBreakdown({
      system_prompt_tokens: 5_000,
      tools_tokens: 20_000,
      skills_tokens: 1_500,
      mcp_tokens: 0,
      subagents_tokens: 800,
      conversation_tokens: 72_700,
      cache_read_tokens: 30_000,
      cache_creation_tokens: 5_000,
    });
    expect(mapped?.cacheReadTokens).toBe(30_000);
    expect(mapped?.cacheCreationTokens).toBe(5_000);
  });

  it("mapWireContextBreakdown defaults missing cache fields to zero", () => {
    const mapped = mapWireContextBreakdown({ conversation_tokens: 100 });
    expect(mapped?.cacheReadTokens).toBe(0);
    expect(mapped?.cacheCreationTokens).toBe(0);
  });

  it("isBreakdownEmpty still treats cache-only payloads as empty", () => {
    // Cache numbers without any bucket tokens means the harness didn't
    // emit the per-bucket breakdown -- UI should fall back to the legacy
    // popover. Adding this test pins down that cache fields do not
    // change the emptiness verdict.
    useContextUsageStore.getState().setContextUtilization("k-cache-only", 0.5, 100_000, {
      systemPromptTokens: 0,
      toolsTokens: 0,
      skillsTokens: 0,
      mcpTokens: 0,
      subagentsTokens: 0,
      conversationTokens: 0,
      cacheReadTokens: 1_234,
      cacheCreationTokens: 567,
    });
    const entry = useContextUsageStore.getState().usageByStreamKey["k-cache-only"];
    expect(entry?.breakdown).toBeUndefined();
  });

  it("mapWireContextBreakdown + setContextUtilization drops an all-zero payload (older harness fallback)", () => {
    const mapped = mapWireContextBreakdown({
      system_prompt_tokens: 0,
      tools_tokens: 0,
      skills_tokens: 0,
      mcp_tokens: 0,
      subagents_tokens: 0,
      conversation_tokens: 0,
    });
    expect(mapped).not.toBeUndefined();
    useContextUsageStore.getState().setContextUtilization("k1", 0.5, 100_000, mapped);
    const entry = useContextUsageStore.getState().usageByStreamKey.k1;
    expect(entry?.breakdown).toBeUndefined();
  });

  it("bumpEstimatedTokens grows the conversation bucket only", () => {
    const s = useContextUsageStore.getState();
    s.setContextUtilization("k1", 0.5, 50_000, {
      systemPromptTokens: 5_000,
      toolsTokens: 10_000,
      skillsTokens: 1_000,
      mcpTokens: 0,
      subagentsTokens: 500,
      conversationTokens: 33_500,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    s.bumpEstimatedTokens("k1", 4_000);

    const breakdown = useContextUsageStore.getState().usageByStreamKey.k1?.breakdown;
    expect(breakdown?.conversationTokens).toBe(37_500);
    // Static buckets stay frozen — they only change between turns,
    // not mid-stream.
    expect(breakdown?.systemPromptTokens).toBe(5_000);
    expect(breakdown?.toolsTokens).toBe(10_000);
    expect(breakdown?.skillsTokens).toBe(1_000);
    expect(breakdown?.subagentsTokens).toBe(500);
  });
});
