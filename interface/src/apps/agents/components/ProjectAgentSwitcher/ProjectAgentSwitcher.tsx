import { Modal } from "@cypher-asi/zui";
import type { AgentInstance } from "../../../../shared/types";
import { MobileProjectAgentSwitcherSheet } from "../../../../mobile/chat/MobileProjectAgentSwitcherSheet";
import styles from "./ProjectAgentSwitcher.module.css";

interface ProjectAgentSwitcherProps {
  isOpen: boolean;
  isMobile: boolean;
  agents: AgentInstance[];
  currentAgentInstanceId: string;
  onClose: () => void;
  onSwitchAgent: (nextAgentInstanceId: string) => void;
}

/**
 * Modal/sheet that lets the user switch between agents inside the same
 * project chat surface. Extracted from the previous monolithic
 * `AgentChatPanel` so the panel only owns the open-state plumbing.
 */
export function ProjectAgentSwitcher({
  isOpen,
  isMobile,
  agents,
  currentAgentInstanceId,
  onClose,
  onSwitchAgent,
}: ProjectAgentSwitcherProps) {
  if (!isOpen) return null;
  if (isMobile) {
    return (
      <MobileProjectAgentSwitcherSheet
        isOpen
        agents={agents}
        currentAgentInstanceId={currentAgentInstanceId}
        onClose={onClose}
        onSwitchAgent={onSwitchAgent}
      />
    );
  }
  return (
    <Modal isOpen onClose={onClose} title="Switch agent" size="sm">
      <div className={styles.body}>
        <div className={styles.header}>
          <span className={styles.name}>Project agents</span>
          <span className={styles.meta}>Switch who you are chatting with.</span>
        </div>
        <div className={styles.list}>
          {agents.map((agent) => {
            const isCurrent = agent.agent_instance_id === currentAgentInstanceId;
            return (
              <button
                key={agent.agent_instance_id}
                type="button"
                className={`${styles.row} ${isCurrent ? styles.rowCurrent : ""}`}
                onClick={() => {
                  if (isCurrent) return;
                  onSwitchAgent(agent.agent_instance_id);
                }}
                aria-label={isCurrent ? `${agent.name}, current agent` : `Switch to ${agent.name}`}
                disabled={isCurrent}
              >
                <span className={styles.copy}>
                  <span className={styles.name}>{agent.name}</span>
                  <span className={styles.meta}>{agent.role?.trim() || "Remote AURA agent"}</span>
                </span>
                {isCurrent ? <span className={styles.status}>Current</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
