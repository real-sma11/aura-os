import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../apps/registry", () => ({
  apps: [
    { id: "agents", basePath: "/agents", label: "Agents" },
    { id: "chat", basePath: "/chat", label: "Chat" },
    { id: "projects", basePath: "/projects", label: "Projects" },
    { id: "tasks", basePath: "/tasks", label: "Tasks" },
    { id: "feed", basePath: "/feed", label: "Feed" },
    { id: "feedback", basePath: "/feedback", label: "Feedback" },
    { id: "notes", basePath: "/notes", label: "Notes" },
  ],
}));

vi.mock("../utils/storage", () => ({
  getTaskbarAppOrder: () => [],
  setTaskbarAppOrder: vi.fn(),
  getTaskbarHiddenAppIds: () => null,
  setTaskbarHiddenAppIds: vi.fn(),
}));

import { useActiveApp, useActiveAppId } from "./use-active-app";
import { useUIModeStore } from "../stores/ui-mode-store";
import { useAuthStore } from "../stores/auth-store";

function wrapperAt(pathname: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[pathname]}>{children}</MemoryRouter>
  );
}

describe("useActiveApp", () => {
  beforeEach(() => {
    // Phase 4: the simple-mode pin overrides path-based resolution and
    // forces ChatApp. The pre-Phase-4 tests assume an authenticated
    // advanced shell where path-based resolution wins; set the store
    // accordingly so each test is unaffected by suite-wide state.
    useAuthStore.setState({
      user: { user_id: "test", display_name: "T" } as never,
    });
    useUIModeStore.setState({ mode: "advanced" });
  });

  afterEach(() => {
    useAuthStore.setState({ user: null });
    useUIModeStore.setState({ mode: "simple" });
  });

  it("derives the app that owns the current pathname", () => {
    const { result } = renderHook(() => useActiveApp(), {
      wrapper: wrapperAt("/projects/abc"),
    });
    expect(result.current.id).toBe("projects");
  });

  it("pins the Chat app when effectiveMode is `simple` regardless of the pathname", () => {
    act(() => {
      useUIModeStore.setState({ mode: "simple" });
    });
    const { result } = renderHook(() => useActiveApp(), {
      wrapper: wrapperAt("/projects/abc"),
    });
    expect(result.current.id).toBe("chat");
  });

  it("does NOT pin Chat in advanced mode (path-based resolution wins)", () => {
    const { result } = renderHook(() => useActiveApp(), {
      wrapper: wrapperAt("/notes"),
    });
    expect(result.current.id).toBe("notes");
  });

  it("distinguishes /feed from /feedback (strict basePath match)", () => {
    const { result } = renderHook(() => useActiveApp(), {
      wrapper: wrapperAt("/feedback/ideas"),
    });
    expect(result.current.id).toBe("feedback");
  });

  it("falls back to the first app for unknown pathnames", () => {
    const { result } = renderHook(() => useActiveApp(), {
      wrapper: wrapperAt("/nonsense"),
    });
    expect(result.current.id).toBe("agents");
  });

  it("useActiveAppId returns the id only", () => {
    const { result } = renderHook(() => useActiveAppId(), {
      wrapper: wrapperAt("/notes"),
    });
    expect(result.current).toBe("notes");
  });
});
