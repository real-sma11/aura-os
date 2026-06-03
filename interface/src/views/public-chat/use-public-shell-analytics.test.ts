import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockTrack, gateState } = vi.hoisted(() => ({
  mockTrack: vi.fn(),
  gateState: { value: false },
}));

vi.mock("../../lib/analytics", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock("../../stores/public-chat-store", () => ({
  selectShouldShowGate: (s: { shouldShowGate: boolean }) => s.shouldShowGate,
  usePublicChatStore: (selector: (s: { shouldShowGate: boolean }) => unknown) =>
    selector({ shouldShowGate: gateState.value }),
}));

import { usePublicGateShown, usePublicPageViewed } from "./use-public-shell-analytics";

function callsFor(event: string): unknown[] {
  return mockTrack.mock.calls.filter(([e]) => e === event);
}

beforeEach(() => {
  vi.clearAllMocks();
  gateState.value = false;
});

describe("usePublicPageViewed", () => {
  it("fires public_page_viewed exactly once on mount", () => {
    const { rerender } = renderHook(() => usePublicPageViewed());
    expect(mockTrack).toHaveBeenCalledWith("public_page_viewed");
    rerender();
    expect(callsFor("public_page_viewed")).toHaveLength(1);
  });
});

describe("usePublicGateShown", () => {
  it("fires public_gate_shown once when the gate trips, and not before", () => {
    const { rerender } = renderHook(() => usePublicGateShown());
    expect(callsFor("public_gate_shown")).toHaveLength(0);

    // turnCount reaches the limit → shouldShowGate becomes true.
    gateState.value = true;
    rerender();
    expect(mockTrack).toHaveBeenCalledWith("public_gate_shown");

    // Stays tripped across re-renders without re-firing.
    rerender();
    expect(callsFor("public_gate_shown")).toHaveLength(1);
  });
});
