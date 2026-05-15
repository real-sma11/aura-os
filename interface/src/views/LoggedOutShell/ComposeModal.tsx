import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import { Box, Image as ImageIcon, ListChecks, Terminal, Video, X } from "lucide-react";
import { DesktopChatInputBar } from "../../features/chat-ui/ChatInputBar";
import {
  AGENT_MODE_DESCRIPTORS,
  AGENT_MODE_ORDER,
  type AgentMode,
} from "../../constants/modes";
import { useChatUI } from "../../stores/chat-ui-store";
import styles from "./LoggedOutShell.module.css";

/**
 * Centered "compose" card mounted as the empty-state for the logged-out
 * chat surface. Acts as a closable modal: the underlying shell stays
 * visible behind the dim overlay, and pressing Esc / clicking the close
 * button hides the card so the visitor can browse "public mode" without
 * the prompt occupying the focus. The first send dismisses the modal
 * automatically (the parent flips to inline-transcript rendering once
 * `messages.length > 0`).
 *
 * Mode-pill widgets sit below the input and proxy to
 * `useChatUI(streamKey).setSelectedMode`, so picking "Image" here is
 * indistinguishable from picking "Image" inside the input bar's own
 * mode menu.
 */
export interface ComposeModalProps {
  input: string;
  onInputChange: (next: string) => void;
  onSend: (content: string) => void;
  onStop: () => void;
  onClose: () => void;
  streamKey: string;
  agentId: string;
  defaultModel: string;
}

interface ModePillSpec {
  mode: AgentMode;
  label: string;
  Icon: typeof Terminal;
}

const MODE_PILLS: ReadonlyArray<ModePillSpec> = [
  { mode: "code", label: "Chat", Icon: Terminal },
  { mode: "plan", label: "Plan", Icon: ListChecks },
  { mode: "image", label: "Create an image", Icon: ImageIcon },
  { mode: "video", label: "Create a video", Icon: Video },
  { mode: "3d", label: "Create a 3D model", Icon: Box },
];

export function ComposeModal({
  input,
  onInputChange,
  onSend,
  onStop,
  onClose,
  streamKey,
  agentId,
  defaultModel,
}: ComposeModalProps) {
  const headingId = useId();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const chatUI = useChatUI(streamKey);
  const { selectedMode, setSelectedMode } = chatUI;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleOverlayMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Click on the dim overlay (not the card itself) closes the modal.
      if (event.target === overlayRef.current) onClose();
    },
    [onClose],
  );

  const handleSelectMode = useCallback(
    (mode: AgentMode) => {
      setSelectedMode(streamKey, mode, "chat", agentId);
    },
    [agentId, setSelectedMode, streamKey],
  );

  const orderedPills = useMemo(() => {
    const order = new Map<AgentMode, number>();
    AGENT_MODE_ORDER.forEach((mode, idx) => order.set(mode, idx));
    return [...MODE_PILLS].sort(
      (a, b) => (order.get(a.mode) ?? 0) - (order.get(b.mode) ?? 0),
    );
  }, []);

  return (
    <div
      ref={overlayRef}
      className={styles.composeOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onMouseDown={handleOverlayMouseDown}
    >
      <div className={styles.composeCard}>
        <button
          type="button"
          className={styles.composeClose}
          onClick={onClose}
          aria-label="Close compose"
          title="Close"
        >
          <X size={16} />
        </button>
        <h2 id={headingId} className={styles.composeHeading}>
          What do you want to create?
        </h2>
        <div className={styles.composeInput}>
          <DesktopChatInputBar
            input={input}
            onInputChange={onInputChange}
            onSend={(content) => onSend(content)}
            onStop={onStop}
            streamKey={streamKey}
            agentId={agentId}
            defaultModel={defaultModel}
          />
        </div>
        <div
          className={styles.composeWidgets}
          role="group"
          aria-label="Generation mode"
        >
          {orderedPills.map(({ mode, label, Icon }) => {
            const descriptor = AGENT_MODE_DESCRIPTORS[mode];
            const isActive = selectedMode === mode;
            return (
              <button
                key={mode}
                type="button"
                className={`${styles.composeWidget} ${
                  isActive ? styles.composeWidgetActive : ""
                }`}
                onClick={() => handleSelectMode(mode)}
                aria-pressed={isActive}
                title={descriptor.description}
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
