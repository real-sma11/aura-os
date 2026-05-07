import { act, renderHook } from "@testing-library/react";
import { useOptimisticSessionRow } from "./use-optimistic-session-row";
import {
  agentSessionsSurfaceKey,
  isOptimisticSessionId,
  projectSessionsSurfaceKey,
  useSessionsListStore,
} from "../../../stores/sessions-list-store";

function resetStore(): void {
  useSessionsListStore.setState({
    sessionsBySurface: {},
    loadingBySurface: {},
    bindingsByAgent: {},
    bindingsLoadStatusByAgent: {},
    pendingSummariesById: {},
    version: 0,
  });
}

describe("useOptimisticSessionRow", () => {
  beforeEach(() => {
    resetStore();
  });

  it("inserts an optimistic row on first send after arm and remembers the id for swap", () => {
    const { result } = renderHook(() =>
      useOptimisticSessionRow({
        projectId: "p1",
        agentInstanceId: "i1",
        projectName: "Project One",
        orgAgentId: "agent-x",
      }),
    );

    const send = vi.fn(() => "ok");

    act(() => {
      result.current.arm();
    });

    let returned: string | undefined;
    act(() => {
      returned = result.current.wrap(send)("hello");
    });
    expect(send).toHaveBeenCalledWith("hello");
    expect(returned).toBe("ok");

    const projectRows =
      useSessionsListStore.getState().sessionsBySurface[
        projectSessionsSurfaceKey("p1")
      ];
    const agentRows =
      useSessionsListStore.getState().sessionsBySurface[
        agentSessionsSurfaceKey("agent-x")
      ];
    expect(projectRows).toHaveLength(1);
    expect(agentRows).toHaveLength(1);
    expect(isOptimisticSessionId(projectRows![0].session_id)).toBe(true);

    const optimisticId = projectRows![0].session_id;

    act(() => {
      result.current.swap("real-A");
    });

    const after =
      useSessionsListStore.getState().sessionsBySurface[
        projectSessionsSurfaceKey("p1")
      ];
    expect(after?.map((s) => s.session_id)).toEqual(["real-A"]);
    // The agent surface should also be swapped.
    expect(
      useSessionsListStore
        .getState()
        .sessionsBySurface[agentSessionsSurfaceKey("agent-x")]
        ?.map((s) => s.session_id),
    ).toEqual(["real-A"]);

    // Sanity: the original optimistic id no longer survives anywhere.
    expect(optimisticId.startsWith("optimistic:")).toBe(true);
  });

  it("cleans up the leaked optimistic row from both surfaces when the panel unmounts before swap", () => {
    // Reproduces the "Bad Request on revisit" flow: the user clicks
    // "+", types, sends, then navigates away before SessionReady
    // arrives. Without the unmount cleanup the optimistic row would
    // sit in `sessionsBySurface` indefinitely, get picked up by
    // default-session redirects on revisit, and 400 the next history
    // fetch.
    const { result, unmount } = renderHook(() =>
      useOptimisticSessionRow({
        projectId: "p1",
        agentInstanceId: "i1",
        projectName: "Project One",
        orgAgentId: "agent-x",
      }),
    );

    const send = vi.fn(() => undefined);
    act(() => {
      result.current.arm();
      result.current.wrap(send)("hello");
    });

    expect(
      useSessionsListStore.getState().sessionsBySurface[
        projectSessionsSurfaceKey("p1")
      ],
    ).toHaveLength(1);
    expect(
      useSessionsListStore.getState().sessionsBySurface[
        agentSessionsSurfaceKey("agent-x")
      ],
    ).toHaveLength(1);

    act(() => {
      unmount();
    });

    expect(
      useSessionsListStore.getState().sessionsBySurface[
        projectSessionsSurfaceKey("p1")
      ],
    ).toEqual([]);
    expect(
      useSessionsListStore.getState().sessionsBySurface[
        agentSessionsSurfaceKey("agent-x")
      ],
    ).toEqual([]);
  });

  it("does not remove a row that has already been swapped to a real id", () => {
    const { result, unmount } = renderHook(() =>
      useOptimisticSessionRow({
        projectId: "p1",
        agentInstanceId: "i1",
        projectName: "Project One",
        orgAgentId: "agent-x",
      }),
    );

    act(() => {
      result.current.arm();
      result.current.wrap(() => undefined)("hello");
      result.current.swap("real-A");
    });

    expect(
      useSessionsListStore.getState().sessionsBySurface[
        projectSessionsSurfaceKey("p1")
      ]?.map((s) => s.session_id),
    ).toEqual(["real-A"]);

    act(() => {
      unmount();
    });

    // Row stays — only optimistic placeholders are swept.
    expect(
      useSessionsListStore.getState().sessionsBySurface[
        projectSessionsSurfaceKey("p1")
      ]?.map((s) => s.session_id),
    ).toEqual(["real-A"]);
  });
});
