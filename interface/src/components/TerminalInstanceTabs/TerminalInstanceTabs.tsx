import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useTerminalPanelStore } from "../../stores/terminal-panel-store";
import { InstanceTabs, type InstanceTab } from "../InstanceTabs";

/**
 * Sidekick terminal session tab strip. Thin wrapper around the shared
 * `InstanceTabs` primitive bound to `useTerminalPanelStore`.
 */
export function TerminalInstanceTabs() {
  const { terminals, activeId, setActiveId, addTerminal, removeTerminal } =
    useTerminalPanelStore(
      useShallow((s) => ({
        terminals: s.terminals,
        activeId: s.activeId,
        setActiveId: s.setActiveId,
        addTerminal: s.addTerminal,
        removeTerminal: s.removeTerminal,
      })),
    );

  const tabs = useMemo<InstanceTab[]>(
    () => terminals.map((t) => ({ id: t.id, title: t.title })),
    [terminals],
  );

  return (
    <InstanceTabs
      tabs={tabs}
      activeId={activeId}
      onActivate={setActiveId}
      onClose={removeTerminal}
      onAdd={addTerminal}
      addAriaLabel="New terminal tab"
    />
  );
}
