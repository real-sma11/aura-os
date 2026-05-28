import {
  clearLastAgentIf,
  getLastAdvancedPath,
  getLastAgent,
  getLastProject,
  getLastSimplePath,
  getProjectOrder,
  getTaskbarAppOrder,
  getTaskbarAppsCollapsed,
  getTaskbarRightCollapsed,
  setLastAdvancedPath,
  setLastAgent,
  setLastProject,
  setLastSimplePath,
  setProjectOrder,
  setTaskbarAppOrder,
  setTaskbarAppsCollapsed,
  setTaskbarRightCollapsed,
} from "./storage";

const LAST_AGENT_KEY = "aura-last-agent";
const LAST_PROJECT_KEY = "aura-last-project";
const PROJECT_ORDER_KEY = "aura-project-order";
const TASKBAR_APP_ORDER_KEY = "aura-taskbar-app-order";
const TASKBAR_APPS_COLLAPSED_KEY = "aura-taskbar-apps-collapsed";
const TASKBAR_RIGHT_COLLAPSED_KEY = "aura-taskbar-right-collapsed";
const LAST_SIMPLE_PATH_KEY = "aura-last-simple-path";
const LAST_ADVANCED_PATH_KEY = "aura-last-advanced-path";

describe("storage", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, val: string) => { store[key] = val; }),
      removeItem: vi.fn((key: string) => { delete store[key]; }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getLastAgent", () => {
    it("returns null when no data stored", () => {
      expect(getLastAgent("p1")).toBeNull();
    });

    it("returns agentInstanceId for the given project", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1", p2: "ai-2" });
      expect(getLastAgent("p1")).toBe("ai-1");
      expect(getLastAgent("p2")).toBe("ai-2");
    });

    it("returns null for an unknown project", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1" });
      expect(getLastAgent("p999")).toBeNull();
    });

    it("returns null for malformed JSON", () => {
      store[LAST_AGENT_KEY] = "not-json";
      expect(getLastAgent("p1")).toBeNull();
    });

    it("returns null for non-object values", () => {
      store[LAST_AGENT_KEY] = JSON.stringify([1, 2, 3]);
      expect(getLastAgent("p1")).toBeNull();
    });

    it("returns null for empty object", () => {
      store[LAST_AGENT_KEY] = "{}";
      expect(getLastAgent("p1")).toBeNull();
    });
  });

  describe("setLastAgent", () => {
    it("stores a single project entry", () => {
      setLastAgent("p1", "ai-1");
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LAST_AGENT_KEY,
        JSON.stringify({ p1: "ai-1" }),
      );
    });

    it("preserves entries for other projects", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1" });
      setLastAgent("p2", "ai-2");
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LAST_AGENT_KEY,
        JSON.stringify({ p1: "ai-1", p2: "ai-2" }),
      );
    });

    it("overwrites the entry for an existing project", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1" });
      setLastAgent("p1", "ai-99");
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LAST_AGENT_KEY,
        JSON.stringify({ p1: "ai-99" }),
      );
    });
  });

  describe("clearLastAgentIf", () => {
    it("removes entry when projectId matches", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1", p2: "ai-2" });
      clearLastAgentIf({ projectId: "p1" });
      expect(store[LAST_AGENT_KEY]).toBe(JSON.stringify({ p2: "ai-2" }));
    });

    it("removes all entries matching agentInstanceId", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1", p2: "ai-1", p3: "ai-3" });
      clearLastAgentIf({ agentInstanceId: "ai-1" });
      expect(store[LAST_AGENT_KEY]).toBe(JSON.stringify({ p3: "ai-3" }));
    });

    it("removes localStorage key entirely when map becomes empty", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1" });
      clearLastAgentIf({ projectId: "p1" });
      expect(localStorage.removeItem).toHaveBeenCalledWith(LAST_AGENT_KEY);
    });

    it("does not modify storage when nothing matches", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1" });
      clearLastAgentIf({ projectId: "p2" });
      expect(localStorage.setItem).not.toHaveBeenCalled();
      expect(localStorage.removeItem).not.toHaveBeenCalled();
    });

    it("handles missing localStorage data gracefully", () => {
      expect(() => clearLastAgentIf({ projectId: "p1" })).not.toThrow();
    });

    it("handles malformed JSON gracefully", () => {
      store[LAST_AGENT_KEY] = "bad-json";
      expect(() => clearLastAgentIf({ projectId: "p1" })).not.toThrow();
    });
  });

  describe("getLastProject", () => {
    it("returns null when no data stored", () => {
      expect(getLastProject()).toBeNull();
    });

    it("returns the stored project id", () => {
      store[LAST_PROJECT_KEY] = "p1";
      expect(getLastProject()).toBe("p1");
    });
  });

  describe("setLastProject", () => {
    it("stores the project id in localStorage", () => {
      setLastProject("p1");
      expect(localStorage.setItem).toHaveBeenCalledWith(LAST_PROJECT_KEY, "p1");
    });

    it("overwrites the previous value", () => {
      store[LAST_PROJECT_KEY] = "p1";
      setLastProject("p2");
      expect(localStorage.setItem).toHaveBeenCalledWith(LAST_PROJECT_KEY, "p2");
    });
  });

  describe("getTaskbarAppsCollapsed", () => {
    it("defaults to collapsed when nothing is stored", () => {
      expect(getTaskbarAppsCollapsed()).toBe(true);
    });

    it("returns true when the collapsed state is stored", () => {
      store[TASKBAR_APPS_COLLAPSED_KEY] = "true";
      expect(getTaskbarAppsCollapsed()).toBe(true);
    });

    it("returns false when the expanded state is stored", () => {
      store[TASKBAR_APPS_COLLAPSED_KEY] = "false";
      expect(getTaskbarAppsCollapsed()).toBe(false);
    });

    it("falls back to collapsed for malformed values", () => {
      store[TASKBAR_APPS_COLLAPSED_KEY] = "maybe";
      expect(getTaskbarAppsCollapsed()).toBe(true);
    });
  });

  describe("getProjectOrder", () => {
    it("defaults to an empty order when nothing is stored", () => {
      expect(getProjectOrder("org-1")).toEqual([]);
    });

    it("returns the stored order for the given org", () => {
      store[`${PROJECT_ORDER_KEY}:org-1`] = JSON.stringify(["p2", "p1"]);
      store[`${PROJECT_ORDER_KEY}:org-2`] = JSON.stringify(["p9"]);

      expect(getProjectOrder("org-1")).toEqual(["p2", "p1"]);
    });

    it("filters out non-string values", () => {
      store[`${PROJECT_ORDER_KEY}:org-1`] = JSON.stringify(["p2", 5, "p1", null]);

      expect(getProjectOrder("org-1")).toEqual(["p2", "p1"]);
    });

    it("falls back to an empty order for malformed JSON", () => {
      store[`${PROJECT_ORDER_KEY}:org-1`] = "not-json";

      expect(getProjectOrder("org-1")).toEqual([]);
    });
  });

  describe("setProjectOrder", () => {
    it("stores the order under an org-scoped key", () => {
      setProjectOrder("org-1", ["p2", "p1"]);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        `${PROJECT_ORDER_KEY}:org-1`,
        JSON.stringify(["p2", "p1"]),
      );
    });

    it("removes the org key when the order is empty", () => {
      setProjectOrder("org-1", []);

      expect(localStorage.removeItem).toHaveBeenCalledWith(`${PROJECT_ORDER_KEY}:org-1`);
    });

    it("uses the shared fallback scope when org is missing", () => {
      setProjectOrder(null, ["p2"]);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        `${PROJECT_ORDER_KEY}:all`,
        JSON.stringify(["p2"]),
      );
    });
  });

  describe("setTaskbarAppsCollapsed", () => {
    it("stores the collapsed state", () => {
      setTaskbarAppsCollapsed(true);
      expect(localStorage.setItem).toHaveBeenCalledWith(TASKBAR_APPS_COLLAPSED_KEY, "true");
    });

    it("stores the expanded state", () => {
      setTaskbarAppsCollapsed(false);
      expect(localStorage.setItem).toHaveBeenCalledWith(TASKBAR_APPS_COLLAPSED_KEY, "false");
    });
  });

  describe("getTaskbarRightCollapsed", () => {
    it("defaults to collapsed when nothing is stored", () => {
      expect(getTaskbarRightCollapsed()).toBe(true);
    });

    it("returns true when the collapsed state is stored", () => {
      store[TASKBAR_RIGHT_COLLAPSED_KEY] = "true";
      expect(getTaskbarRightCollapsed()).toBe(true);
    });

    it("returns false when the expanded state is stored", () => {
      store[TASKBAR_RIGHT_COLLAPSED_KEY] = "false";
      expect(getTaskbarRightCollapsed()).toBe(false);
    });

    it("falls back to collapsed for malformed values", () => {
      store[TASKBAR_RIGHT_COLLAPSED_KEY] = "maybe";
      expect(getTaskbarRightCollapsed()).toBe(true);
    });
  });

  describe("setTaskbarRightCollapsed", () => {
    it("stores the collapsed state", () => {
      setTaskbarRightCollapsed(true);
      expect(localStorage.setItem).toHaveBeenCalledWith(TASKBAR_RIGHT_COLLAPSED_KEY, "true");
    });

    it("stores the expanded state", () => {
      setTaskbarRightCollapsed(false);
      expect(localStorage.setItem).toHaveBeenCalledWith(TASKBAR_RIGHT_COLLAPSED_KEY, "false");
    });
  });

  describe("getTaskbarAppOrder", () => {
    it("defaults to an empty order when nothing is stored", () => {
      expect(getTaskbarAppOrder()).toEqual([]);
    });

    it("returns the stored app order", () => {
      store[TASKBAR_APP_ORDER_KEY] = JSON.stringify(["tasks", "agents"]);
      expect(getTaskbarAppOrder()).toEqual(["tasks", "agents"]);
    });

    it("filters out non-string values", () => {
      store[TASKBAR_APP_ORDER_KEY] = JSON.stringify(["tasks", 5, "agents", null]);
      expect(getTaskbarAppOrder()).toEqual(["tasks", "agents"]);
    });

    it("falls back to an empty order for malformed JSON", () => {
      store[TASKBAR_APP_ORDER_KEY] = "not-json";
      expect(getTaskbarAppOrder()).toEqual([]);
    });
  });

  describe("setTaskbarAppOrder", () => {
    it("stores the app order", () => {
      setTaskbarAppOrder(["tasks", "agents"]);
      expect(localStorage.setItem).toHaveBeenCalledWith(
        TASKBAR_APP_ORDER_KEY,
        JSON.stringify(["tasks", "agents"]),
      );
    });

    it("removes the key when the order is empty", () => {
      setTaskbarAppOrder([]);
      expect(localStorage.removeItem).toHaveBeenCalledWith(TASKBAR_APP_ORDER_KEY);
    });
  });

  // Per-mode last-path tracking — read by `ModeToggle` so the
  // Simple <-> Advanced flip restores the URL the user had last seen
  // in the destination mode. The setters validate that Simple paths
  // start with `/chat` and Advanced paths do not, so a hand-edited /
  // stale entry can't drive `navigate()` to an invalid surface.
  describe("getLastSimplePath", () => {
    it("returns null when no value is stored", () => {
      expect(getLastSimplePath()).toBeNull();
    });

    it("returns a stored /chat path verbatim", () => {
      store[LAST_SIMPLE_PATH_KEY] = "/chat?session=abc";
      expect(getLastSimplePath()).toBe("/chat?session=abc");
    });

    it("returns a stored /chat/<sub> subpath", () => {
      store[LAST_SIMPLE_PATH_KEY] = "/chat/session-123";
      expect(getLastSimplePath()).toBe("/chat/session-123");
    });

    it("returns null when the stored value is not a /chat path", () => {
      // Defensive: a hand-edited entry under the wrong key must not
      // drive `navigate()` to the wrong surface.
      store[LAST_SIMPLE_PATH_KEY] = "/notes/abc";
      expect(getLastSimplePath()).toBeNull();
    });

    it("returns null for restore-invalid paths (e.g. /api/...)", () => {
      store[LAST_SIMPLE_PATH_KEY] = "/api/foo";
      expect(getLastSimplePath()).toBeNull();
    });
  });

  describe("setLastSimplePath", () => {
    it("persists a sanitized /chat path", () => {
      setLastSimplePath("/chat?session=abc");
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LAST_SIMPLE_PATH_KEY,
        "/chat?session=abc",
      );
    });

    it("strips the `host` query param via sanitizeRestorePath", () => {
      setLastSimplePath("/chat?session=abc&host=foo");
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LAST_SIMPLE_PATH_KEY,
        "/chat?session=abc",
      );
    });

    it("drops non-/chat paths silently (no write)", () => {
      setLastSimplePath("/notes/abc");
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it("drops invalid restore paths (e.g. /login) silently", () => {
      setLastSimplePath("/login");
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });
  });

  describe("getLastAdvancedPath", () => {
    it("returns null when no value is stored", () => {
      expect(getLastAdvancedPath()).toBeNull();
    });

    it("returns a stored non-/chat path verbatim", () => {
      store[LAST_ADVANCED_PATH_KEY] = "/notes/note-1";
      expect(getLastAdvancedPath()).toBe("/notes/note-1");
    });

    it("returns null when the stored value is a /chat path", () => {
      // Defensive: prevents Advanced -> Simple thrash if someone
      // wrote a `/chat...` URL under the Advanced key.
      store[LAST_ADVANCED_PATH_KEY] = "/chat?session=abc";
      expect(getLastAdvancedPath()).toBeNull();
    });

    it("returns null for restore-invalid paths (e.g. /desktop)", () => {
      store[LAST_ADVANCED_PATH_KEY] = "/desktop";
      expect(getLastAdvancedPath()).toBeNull();
    });
  });

  describe("setLastAdvancedPath", () => {
    it("persists a sanitized non-/chat path", () => {
      setLastAdvancedPath("/projects/abc?tab=tasks");
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LAST_ADVANCED_PATH_KEY,
        "/projects/abc?tab=tasks",
      );
    });

    it("drops /chat paths silently (no write)", () => {
      setLastAdvancedPath("/chat?session=abc");
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it("drops invalid restore paths silently", () => {
      setLastAdvancedPath("/api/foo");
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });
  });
});
