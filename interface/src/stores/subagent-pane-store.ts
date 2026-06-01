import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { SubagentState } from "../shared/types/harness-protocol";

/**
 * Descriptor for the subagent thread surfaced in a parent chat's
 * slide-over pane. Mirrors the props the retired `SubAgentModal` took,
 * sourced from the originating `task` tool card (`SubAgentBlock`).
 */
export interface SubAgentPaneDescriptor {
  childRunId: string;
  parentToolUseId?: string;
  subagentType: string;
  prompt: string;
  state: SubagentState;
  reason?: string;
}

interface SubAgentPaneState {
  /**
   * Active subagent pane per parent `streamKey`. A `ChatPanel` reads its
   * own entry to decide whether to render the slide-over and retarget
   * the shared input bar. Keyed by the parent stream so independent
   * chat surfaces (multiple windows / panels) never collide.
   */
  panes: Record<string, SubAgentPaneDescriptor>;
  openPane: (parentStreamKey: string, descriptor: SubAgentPaneDescriptor) => void;
  closePane: (parentStreamKey: string) => void;
}

export const useSubAgentPaneStore = create<SubAgentPaneState>()((set) => ({
  panes: {},
  openPane: (parentStreamKey, descriptor) =>
    set((s) => ({
      panes: { ...s.panes, [parentStreamKey]: descriptor },
    })),
  closePane: (parentStreamKey) =>
    set((s) => {
      if (!(parentStreamKey in s.panes)) return s;
      const next = { ...s.panes };
      delete next[parentStreamKey];
      return { panes: next };
    }),
}));

/** Subscribe to the active subagent pane for a parent stream key. */
export function useSubAgentPane(
  parentStreamKey: string | undefined,
): SubAgentPaneDescriptor | undefined {
  return useSubAgentPaneStore((s) =>
    parentStreamKey ? s.panes[parentStreamKey] : undefined,
  );
}

/** Stable open/close actions (shallow-compared so they never re-render). */
export function useSubAgentPaneActions(): Pick<
  SubAgentPaneState,
  "openPane" | "closePane"
> {
  return useSubAgentPaneStore(
    useShallow((s) => ({ openPane: s.openPane, closePane: s.closePane })),
  );
}
