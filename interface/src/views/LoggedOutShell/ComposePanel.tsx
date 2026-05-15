import { useCallback, useMemo } from "react";
import { Box, Image as ImageIcon, ListChecks, Terminal, Video } from "lucide-react";
import { DesktopChatInputBar } from "../../features/chat-ui/ChatInputBar";
import {
  AGENT_MODE_DESCRIPTORS,
  AGENT_MODE_ORDER,
  type AgentMode,
} from "../../constants/modes";
import { useChatUI } from "../../stores/chat-ui-store";
import styles from "./LoggedOutShell.module.css";

/**
 * Inline empty-state compose surface for the logged-out chat view.
 * Renders the compose heading + the shared `DesktopChatInputBar` +
 * a row of mode-pill widgets directly in the main panel — no modal
 * overlay, no dim wash. Once the visitor sends a message, the parent
 * (`LoggedOutChatView`) flips to the inline-transcript layout and
 * stops mounting this surface.
 *
 * Mode-pill widgets proxy to `useChatUI(streamKey).setSelectedMode`
 * so picking "Image" here is indistinguishable from picking "Image"
 * inside the input bar's own segmented control.
 */
export interface ComposePanelProps {
  input: string;
  onInputChange: (next: string) => void;
  onSend: (content: string) => void;
  onStop: () => void;
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

export function ComposePanel({
  input,
  onInputChange,
  onSend,
  onStop,
  streamKey,
  agentId,
  defaultModel,
}: ComposePanelProps) {
  const chatUI = useChatUI(streamKey);
  const { selectedMode, setSelectedMode } = chatUI;

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
      className={styles.composePanel}
      role="region"
      aria-label="Start a new conversation"
    >
      <h2 className={styles.composeHeading}>What do you want to create?</h2>
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
  );
}
