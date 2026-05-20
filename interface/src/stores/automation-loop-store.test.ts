import { beforeEach, describe, expect, it } from "vitest";

import { useAutomationLoopStore } from "./automation-loop-store";
import type { ProjectId } from "../shared/types";

const PROJECT_A = "proj-a" as ProjectId;
const PROJECT_B = "proj-b" as ProjectId;

beforeEach(() => {
  useAutomationLoopStore.getState().reset();
  try {
    localStorage.clear();
  } catch {
    // localStorage is always available under jsdom; stay defensive.
  }
});

describe("automation-loop-store", () => {
  describe("loopByProject (bound agent id)", () => {
    it("round-trips the bound loop agent id per project", () => {
      const store = useAutomationLoopStore.getState();
      store.setLoopAgent(PROJECT_A, "loop-agent-a");
      store.setLoopAgent(PROJECT_B, "loop-agent-b");
      expect(useAutomationLoopStore.getState().getLoopAgent(PROJECT_A)).toBe(
        "loop-agent-a",
      );
      expect(useAutomationLoopStore.getState().getLoopAgent(PROJECT_B)).toBe(
        "loop-agent-b",
      );
    });

    it("clearLoopAgent only drops the targeted project", () => {
      const store = useAutomationLoopStore.getState();
      store.setLoopAgent(PROJECT_A, "loop-agent-a");
      store.setLoopAgent(PROJECT_B, "loop-agent-b");
      store.clearLoopAgent(PROJECT_A);
      expect(useAutomationLoopStore.getState().getLoopAgent(PROJECT_A)).toBeNull();
      expect(useAutomationLoopStore.getState().getLoopAgent(PROJECT_B)).toBe(
        "loop-agent-b",
      );
    });
  });

  describe("modelByProject (per-project automation model)", () => {
    it("returns null when nothing is persisted yet", () => {
      expect(useAutomationLoopStore.getState().getLoopModel(PROJECT_A)).toBeNull();
    });

    it("setLoopModel writes both the in-memory map and localStorage", () => {
      useAutomationLoopStore.getState().setLoopModel(PROJECT_A, "aura-claude-opus-4-7");
      expect(useAutomationLoopStore.getState().getLoopModel(PROJECT_A)).toBe(
        "aura-claude-opus-4-7",
      );
      expect(
        localStorage.getItem("aura-automation-model:project:proj-a"),
      ).toBe("aura-claude-opus-4-7");
    });

    it("getLoopModel falls back to localStorage when the in-memory map is empty (refresh path)", () => {
      // Simulate a previous session that wrote the pick before this
      // store instance existed.
      localStorage.setItem(
        "aura-automation-model:project:proj-a",
        "aura-gpt-5-5",
      );
      // Reset only the zustand state; localStorage stays populated.
      useAutomationLoopStore.setState({
        loopByProject: {},
        modelByProject: {},
      });
      expect(useAutomationLoopStore.getState().getLoopModel(PROJECT_A)).toBe(
        "aura-gpt-5-5",
      );
    });

    it("setLoopModel(null) clears both the map entry and the localStorage key", () => {
      useAutomationLoopStore.getState().setLoopModel(PROJECT_A, "aura-claude-opus-4-7");
      useAutomationLoopStore.getState().setLoopModel(PROJECT_A, null);
      expect(useAutomationLoopStore.getState().getLoopModel(PROJECT_A)).toBeNull();
      expect(
        localStorage.getItem("aura-automation-model:project:proj-a"),
      ).toBeNull();
    });

    it("models are scoped per project — picking for A does not leak into B", () => {
      useAutomationLoopStore.getState().setLoopModel(PROJECT_A, "aura-claude-opus-4-7");
      expect(useAutomationLoopStore.getState().getLoopModel(PROJECT_A)).toBe(
        "aura-claude-opus-4-7",
      );
      expect(useAutomationLoopStore.getState().getLoopModel(PROJECT_B)).toBeNull();
    });

    it("reset() clears the in-memory map but not localStorage (refresh would still rehydrate)", () => {
      useAutomationLoopStore.getState().setLoopModel(PROJECT_A, "aura-gpt-5-5");
      useAutomationLoopStore.getState().reset();
      // In-memory map is empty, but the persistence layer survives —
      // a fresh read picks it back up so the user's choice survives
      // a logical reset (e.g. between tests, or a deliberate
      // store-level reset triggered by a sign-out flow).
      expect(useAutomationLoopStore.getState().getLoopModel(PROJECT_A)).toBe(
        "aura-gpt-5-5",
      );
    });
  });
});
