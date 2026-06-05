import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useAfterPaint } from "./use-after-paint";

describe("useAfterPaint", () => {
  it("starts false and flips to true after a frame", async () => {
    const { result } = renderHook(() => useAfterPaint());
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("starts true immediately when skipped", () => {
    const { result } = renderHook(() => useAfterPaint(true));
    expect(result.current).toBe(true);
  });
});
