import { useEffect, useRef, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useTerminalPanelStore } from "../../../stores/terminal-panel-store";
import { useSidekickStore } from "../../../stores/sidekick-store";
import { useTerminalTarget } from "../../../hooks/use-terminal-target";

export function ProjectMainPanel({ children }: { children?: ReactNode }) {
  const { projectId, agentInstanceId } = useParams<{ projectId: string; agentInstanceId: string }>();
  const setTerminalTarget = useTerminalPanelStore((s) => s.setTerminalTarget);

  const { remoteAgentId, workspacePath, status } = useTerminalTarget({ projectId, agentInstanceId });

  // Force the Projects-app sidekick to start on the Terminal tab. The shared
  // sidekick store persists the last tab to localStorage and is also mutated
  // by the Tasks app (writes "tasks") and the spec-generation stream (writes
  // "specs"), which otherwise leaks foreign defaults into Projects entry.
  // Guard with a ref so this only runs once per ProjectMainPanel mount, not
  // on every project switch — switching tabs within the session still sticks.
  const didInitSidekickTab = useRef(false);
  useEffect(() => {
    if (didInitSidekickTab.current) return;
    didInitSidekickTab.current = true;
    useSidekickStore.getState().setActiveTab("terminal");
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    setTerminalTarget({ cwd: workspacePath, remoteAgentId, projectId });
  }, [projectId, remoteAgentId, setTerminalTarget, status, workspacePath]);

  return <>{children}</>;
}
