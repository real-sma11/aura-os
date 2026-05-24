import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./stream/hooks", () => ({
  useIsStreaming: vi.fn(() => false),
}));

import { useIsStreaming } from "./stream/hooks";
import { useContextUsageStore } from "../stores/context-usage-store";
import { useHydrateContextUtilization } from "./use-hydrate-context-utilization";

describe("useHydrateContextUtilization", () => {
  beforeEach(() => {
    useContextUsageStore.setState({
      usageByStreamKey: {},
      resetPendingByStreamKey: {},
    });
    vi.mocked(useIsStreaming).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("seeds the store with the latest session's context utilization on mount", async () => {
    const fetcher = vi.fn().mockResolvedValue({ context_utilization: 0.42 });

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, "agent-1"));

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(
        useContextUsageStore.getState().usageByStreamKey["stream-1"]?.utilization,
      ).toBeCloseTo(0.42);
    });
  });

  it("seeds estimated tokens when the server returns them", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      context_utilization: 0.42,
      estimated_context_tokens: 84_000,
    });

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, "agent-1"));

    await waitFor(() => {
      const entry = useContextUsageStore.getState().usageByStreamKey["stream-1"];
      expect(entry?.utilization).toBeCloseTo(0.42);
      expect(entry?.estimatedTokens).toBe(84_000);
    });
  });

  it("skips hydration when the reset sentinel is pending", async () => {
    useContextUsageStore.getState().markResetPending("stream-1");
    const fetcher = vi.fn().mockResolvedValue({ context_utilization: 0.9 });

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, "agent-1"));

    await new Promise((r) => setTimeout(r, 10));
    expect(fetcher).not.toHaveBeenCalled();
    expect(useContextUsageStore.getState().usageByStreamKey["stream-1"]).toBeUndefined();
  });

  it("skips hydration when the store already has a value", async () => {
    useContextUsageStore.getState().setContextUtilization("stream-1", 0.33);
    const fetcher = vi.fn().mockResolvedValue({ context_utilization: 0.9 });

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, "agent-1"));

    await new Promise((r) => setTimeout(r, 10));
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      useContextUsageStore.getState().usageByStreamKey["stream-1"]?.utilization,
    ).toBeCloseTo(0.33);
  });

  it("skips hydration when a stream is active", async () => {
    vi.mocked(useIsStreaming).mockReturnValue(true);
    const fetcher = vi.fn().mockResolvedValue({ context_utilization: 0.42 });

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, "agent-1"));

    await new Promise((r) => setTimeout(r, 10));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not write a zero value to the store", async () => {
    const fetcher = vi.fn().mockResolvedValue({ context_utilization: 0 });

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, "agent-1"));

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
    expect(useContextUsageStore.getState().usageByStreamKey["stream-1"]).toBeUndefined();
  });

  it("does not seed if reset was marked after fetch started but before it resolved", async () => {
    let resolveFetch:
      | ((v: { context_utilization: number; estimated_context_tokens?: number }) => void)
      | null = null;
    const fetcher = vi.fn(
      () =>
        new Promise<{ context_utilization: number; estimated_context_tokens?: number }>(
          (resolve) => {
            resolveFetch = resolve;
          },
        ),
    );

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, "agent-1"));

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    useContextUsageStore.getState().markResetPending("stream-1");
    resolveFetch?.({ context_utilization: 0.77 });

    await new Promise((r) => setTimeout(r, 10));
    expect(useContextUsageStore.getState().usageByStreamKey["stream-1"]).toBeUndefined();
    expect(useContextUsageStore.getState().isResetPending("stream-1")).toBe(true);
  });

  it("does nothing when resetKey is undefined", async () => {
    const fetcher = vi.fn();

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, undefined));

    await new Promise((r) => setTimeout(r, 10));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does nothing when fetcher is undefined", async () => {
    renderHook(() => useHydrateContextUtilization("stream-1", undefined, "agent-1"));

    await new Promise((r) => setTimeout(r, 10));
    expect(useContextUsageStore.getState().usageByStreamKey["stream-1"]).toBeUndefined();
  });

  // Regression for the "old context hover keeps showing on chat open"
  // bug: when the server's context-usage endpoint includes a non-empty
  // `context_breakdown`, the store must surface it so
  // `ContextUsageIndicator` renders the new stacked-bar popover
  // immediately on mount instead of falling back to the legacy
  // Used/Total card until the next assistant turn arrives.
  it("seeds the per-bucket breakdown when the server returns one", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      context_utilization: 0.42,
      estimated_context_tokens: 84_000,
      context_breakdown: {
        system_prompt_tokens: 4_000,
        tools_tokens: 6_500,
        skills_tokens: 1_200,
        mcp_tokens: 0,
        subagents_tokens: 800,
        conversation_tokens: 71_500,
      },
    });

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, "agent-1"));

    await waitFor(() => {
      const entry = useContextUsageStore.getState().usageByStreamKey["stream-1"];
      expect(entry?.breakdown).toEqual({
        systemPromptTokens: 4_000,
        toolsTokens: 6_500,
        skillsTokens: 1_200,
        mcpTokens: 0,
        subagentsTokens: 800,
        conversationTokens: 71_500,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      });
    });
  });

  // Older harness builds emit `ContextBreakdown::default()` (every
  // bucket = 0); the store's `isBreakdownEmpty` filter drops these so
  // the indicator stays on the legacy popover branch. Verify the
  // hydrate path doesn't accidentally bypass that guard.
  it("drops an all-zero breakdown so older harness builds fall back to the legacy card", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      context_utilization: 0.42,
      estimated_context_tokens: 84_000,
      context_breakdown: {
        system_prompt_tokens: 0,
        tools_tokens: 0,
        skills_tokens: 0,
        mcp_tokens: 0,
        subagents_tokens: 0,
        conversation_tokens: 0,
      },
    });

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, "agent-1"));

    await waitFor(() => {
      const entry = useContextUsageStore.getState().usageByStreamKey["stream-1"];
      expect(entry?.utilization).toBeCloseTo(0.42);
      expect(entry?.breakdown).toBeUndefined();
    });
  });
});
