/**
 * Phase 5 vitest for the client-side stream-close breadcrumb. Pins
 * the contract every chat-hook consumer relies on:
 *
 * - dispatching always emits a single `aura:stream-close` CustomEvent;
 * - the `detail` payload is the same shape that was passed in;
 * - the dispatch is robust to a missing `window` (jsdom edge cases
 *   and SSR bundles).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  recordStreamCloseReason,
  STREAM_CLOSE_EVENT,
  type StreamCloseReason,
} from "./stream-breadcrumbs";

describe("recordStreamCloseReason", () => {
  let received: StreamCloseReason[] = [];
  let listener: ((event: Event) => void) | null = null;

  beforeEach(() => {
    received = [];
    listener = (event: Event) => {
      const detail = (event as CustomEvent<StreamCloseReason>).detail;
      received.push(detail);
    };
    window.addEventListener(STREAM_CLOSE_EVENT, listener);
  });

  afterEach(() => {
    if (listener) {
      window.removeEventListener(STREAM_CLOSE_EVENT, listener);
      listener = null;
    }
    vi.restoreAllMocks();
  });

  it("dispatches a single aura:stream-close CustomEvent with the reason in detail", () => {
    const reason: StreamCloseReason = {
      classified: "completed",
      message: "ok",
    };
    recordStreamCloseReason(reason);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(reason);
  });

  it("forwards optional code and auto_retry fields verbatim through detail", () => {
    const reason: StreamCloseReason = {
      classified: "streamDropped",
      message: "WebSocket closed",
      code: "harness_ws_closed",
      auto_retry: true,
    };
    recordStreamCloseReason(reason);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(reason);
    expect(received[0].code).toBe("harness_ws_closed");
    expect(received[0].auto_retry).toBe(true);
  });

  it("dispatches once per call so a multi-step lifecycle produces one breadcrumb per terminator", () => {
    recordStreamCloseReason({ classified: "completed", message: "first" });
    recordStreamCloseReason({ classified: "failed", message: "second" });
    recordStreamCloseReason({
      classified: "agentBusy",
      message: "third",
      code: "agent_busy",
    });

    expect(received).toHaveLength(3);
    expect(received[0].classified).toBe("completed");
    expect(received[1].classified).toBe("failed");
    expect(received[2].classified).toBe("agentBusy");
    expect(received[2].code).toBe("agent_busy");
  });

  it("never throws when window.dispatchEvent fails (listener remains observability-only)", () => {
    const original = window.dispatchEvent;
    window.dispatchEvent = vi.fn(() => {
      throw new Error("listener blew up");
    });

    expect(() =>
      recordStreamCloseReason({ classified: "failed", message: "x" }),
    ).not.toThrow();

    window.dispatchEvent = original;
  });
});
