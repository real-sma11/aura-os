import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markStoragePressure } from "./boot-diagnostics";

describe("markStoragePressure", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    window.localStorage.clear();
  });

  it("warns (not errors) when localStorage exceeds the 3MB threshold", () => {
    // ~4 MB of UTF-16 code units → well above the 3 MB threshold.
    const big = "x".repeat(4 * 1024 * 1024);
    window.localStorage.setItem("aura-big-key", big);

    markStoragePressure();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message, payload] = warnSpy.mock.calls[0];
    expect(message).toBe("[aura-boot] localStorage pressure");
    expect(payload).toMatchObject({
      totalKB: expect.any(Number),
      topKeys: expect.any(Array),
    });
    const { topKeys } = payload as { topKeys: Array<{ key: string; kb: number }> };
    expect(topKeys[0]?.key).toBe("aura-big-key");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("is silent when localStorage is comfortably below the threshold", () => {
    window.localStorage.setItem("small", "hello");

    markStoragePressure();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
