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

  it("inserts an optimistic row on arm so the sidekick can highlight it before the first send, and remembers the id for swap", () => {
    const { result } = renderHook(() =>
      useOptimisticSessionRow({
        projectId: "p1",
        agentInstanceId: "i1",
        projectName: "Project One",
        orgAgentId: "agent-x",
      }),
    );

    // No row yet — list is untouched until the user actually clicks "+".
    expect(
      useSessionsListStore.getState().sessionsBySurface[
        projectSessionsSurfaceKey("p1")
      ],
    ).toBeUndefined();

    act(() => {
      result.current.arm();
    });

    // The placeholder lands in *both* surfaces (project + agent) the
    // moment the user presses "+", so `effectiveSelectedSessionId` in
    // `SessionsList` can pick it up via the optimistic-fallback branch
    // and render the row as selected without waiting for first send.
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

    // `wrap` is a passthrough now — first send doesn't insert a *second*
    // row; the placeholder from `arm` is reused.
    const send = vi.fn(() => "ok");
    let returned: string | undefined;
    act(() => {
      returned = result.current.wrap(send)("hello");
    });
    expect(send).toHaveBeenCalledWith("hello");
    expect(returned).toBe("ok");
    expect(
      useSessionsListStore.getState().sessionsBySurface[
        projectSessionsSurfaceKey("p1")
      ],
    ).toHaveLength(1);

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

  it("is idempotent across repeated arm() calls so a double-click on '+' doesn't stack placeholders", () => {
    const { result } = renderHook(() =>
      useOptimisticSessionRow({
        projectId: "p1",
        agentInstanceId: "i1",
        projectName: "Project One",
        orgAgentId: "agent-x",
      }),
    );

    act(() => {
      result.current.arm();
      result.current.arm();
      result.current.arm();
    });

    const rows =
      useSessionsListStore.getState().sessionsBySurface[
        projectSessionsSurfaceKey("p1")
      ];
    expect(rows).toHaveLength(1);
    expect(isOptimisticSessionId(rows![0].session_id)).toBe(true);
  });

  it("re-arms after a swap so a subsequent '+' inserts a fresh placeholder", () => {
    const { result } = renderHook(() =>
      useOptimisticSessionRow({
        projectId: "p1",
        agentInstanceId: "i1",
        projectName: "Project One",
        orgAgentId: "agent-x",
      }),
    );

    act(() => {
      result.current.arm();
      result.current.swap("real-A");
    });

    expect(
      useSessionsListStore.getState().sessionsBySurface[
        projectSessionsSurfaceKey("p1")
      ]?.map((s) => s.session_id),
    ).toEqual(["real-A"]);

    act(() => {
      result.current.arm();
    });

    const rows =
      useSessionsListStore.getState().sessionsBySurface[
        projectSessionsSurfaceKey("p1")
      ];
    expect(rows).toHaveLength(2);
    expect(rows!.map((s) => s.session_id).sort()).toEqual(
      [...rows!.map((s) => s.session_id)].sort(),
    );
    expect(rows!.some((s) => isOptimisticSessionId(s.session_id))).toBe(true);
    expect(rows!.some((s) => s.session_id === "real-A")).toBe(true);
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
    expect(send).toHaveBeenCalledWith("hello");

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
