import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkForUpdatesMock = vi.fn(async () => ({ ok: true }));

vi.mock("../../api/client", () => ({
  api: {
    checkForUpdates: (...args: unknown[]) => checkForUpdatesMock(...args),
  },
}));

import { useFocusUpdateCheck } from "./useFocusUpdateCheck";

function fireFocus() {
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
}

function fireVisible() {
  act(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  checkForUpdatesMock.mockClear();
  checkForUpdatesMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useFocusUpdateCheck", () => {
  it("does not attach listeners when disabled", () => {
    const onChecked = vi.fn(async () => {});
    renderHook(() =>
      useFocusUpdateCheck({ enabled: false, status: "up_to_date", onChecked }),
    );
    fireFocus();
    expect(checkForUpdatesMock).not.toHaveBeenCalled();
    expect(onChecked).not.toHaveBeenCalled();
  });

  it("triggers a check on window focus", async () => {
    const onChecked = vi.fn(async () => {});
    renderHook(() =>
      useFocusUpdateCheck({ enabled: true, status: "up_to_date", onChecked }),
    );
    fireFocus();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
    expect(onChecked).toHaveBeenCalledTimes(1);
  });

  it("triggers a check on visibilitychange when document becomes visible", async () => {
    const onChecked = vi.fn(async () => {});
    renderHook(() =>
      useFocusUpdateCheck({ enabled: true, status: "up_to_date", onChecked }),
    );
    fireVisible();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
  });

  it("rate-limits repeat focus events within the cooldown window", async () => {
    const onChecked = vi.fn(async () => {});
    renderHook(() =>
      useFocusUpdateCheck({ enabled: true, status: "up_to_date", onChecked }),
    );

    fireFocus();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireFocus();
    fireFocus();
    await act(async () => {
      await Promise.resolve();
    });

    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
  });

  it("re-checks once the cooldown elapses", async () => {
    const onChecked = vi.fn(async () => {});
    renderHook(() =>
      useFocusUpdateCheck({ enabled: true, status: "up_to_date", onChecked }),
    );

    fireFocus();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    fireFocus();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(checkForUpdatesMock).toHaveBeenCalledTimes(2);
  });

  it.each(["downloading", "installing"])(
    "does not trigger a check while status is %s",
    async (status) => {
      const onChecked = vi.fn(async () => {});
      renderHook(() =>
        useFocusUpdateCheck({ enabled: true, status, onChecked }),
      );
      fireFocus();
      fireVisible();
      await act(async () => {
        await Promise.resolve();
      });
      expect(checkForUpdatesMock).not.toHaveBeenCalled();
      expect(onChecked).not.toHaveBeenCalled();
    },
  );

  it("removes listeners on unmount", () => {
    const onChecked = vi.fn(async () => {});
    const { unmount } = renderHook(() =>
      useFocusUpdateCheck({ enabled: true, status: "up_to_date", onChecked }),
    );
    unmount();
    fireFocus();
    expect(checkForUpdatesMock).not.toHaveBeenCalled();
  });
});
