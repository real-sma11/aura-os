import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectDownloadPlatform,
  normalizeDownloadTarget,
} from "./download-targets";

interface NavigatorOverrides {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

function stubNavigator(overrides: NavigatorOverrides): void {
  const original = window.navigator;
  const proxy = new Proxy(original, {
    get(target, prop) {
      if (prop === "platform" && overrides.platform !== undefined) {
        return overrides.platform;
      }
      if (prop === "userAgent" && overrides.userAgent !== undefined) {
        return overrides.userAgent;
      }
      if (prop === "userAgentData" && overrides.userAgentData !== undefined) {
        return overrides.userAgentData;
      }
      return Reflect.get(target, prop, target);
    },
  });
  vi.stubGlobal("navigator", proxy);
  // jsdom's window.navigator is non-configurable by default; mirror the
  // stub onto it so code reading `window.navigator` rather than the
  // free-standing `navigator` global picks up the same overrides.
  Object.defineProperty(window, "navigator", {
    configurable: true,
    writable: true,
    value: proxy,
  });
}

describe("normalizeDownloadTarget", () => {
  it("accepts known targets case-insensitively", () => {
    expect(normalizeDownloadTarget("Windows")).toBe("windows");
    expect(normalizeDownloadTarget("MAC")).toBe("mac");
    expect(normalizeDownloadTarget("linux")).toBe("linux");
  });

  it("rejects unknown / empty values", () => {
    expect(normalizeDownloadTarget(undefined)).toBeUndefined();
    expect(normalizeDownloadTarget(null)).toBeUndefined();
    expect(normalizeDownloadTarget("")).toBeUndefined();
    expect(normalizeDownloadTarget("plan9")).toBeUndefined();
  });
});

describe("detectDownloadPlatform", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("identifies Windows from userAgentData", () => {
    stubNavigator({ userAgentData: { platform: "Windows" }, platform: "" });
    expect(detectDownloadPlatform()).toBe("windows");
  });

  it("identifies macOS from navigator.platform", () => {
    stubNavigator({ platform: "MacIntel", userAgent: "" });
    expect(detectDownloadPlatform()).toBe("mac");
  });

  it("identifies iPad as mac (closest installer)", () => {
    stubNavigator({
      platform: "",
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15",
    });
    expect(detectDownloadPlatform()).toBe("mac");
  });

  it("identifies Linux from userAgent", () => {
    stubNavigator({
      platform: "",
      userAgent: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) Gecko",
    });
    expect(detectDownloadPlatform()).toBe("linux");
  });

  it("returns unknown when no signal is present", () => {
    stubNavigator({ platform: "", userAgent: "SomeOddBrowser/1.0" });
    expect(detectDownloadPlatform()).toBe("unknown");
  });
});
