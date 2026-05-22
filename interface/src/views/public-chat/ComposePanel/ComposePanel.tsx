import { useCallback, useRef } from "react";
import { BookOpen, Globe, MapPin, Terminal } from "lucide-react";
import {
  DesktopChatInputBar,
  type ChatInputBarHandle,
} from "../../../features/chat-ui/ChatInputBar";
import { type AgentMode } from "../../../constants/modes";
import { useChatUI } from "../../../stores/chat-ui-store";
import { AgentDemoBanner } from "../AgentDemoBanner";
import styles from "./ComposePanel.module.css";

/**
 * Inline empty-state compose surface for the public chat view.
 * Renders, top-to-bottom:
 *   1. A pink/purple gradient hero (`AgentDemoBanner`) that loops a
 *      scripted multi-agent collaboration — three agents trading
 *      messages, tool calls, and approvals — as a live-feeling
 *      demonstration of what the platform can do. Replaced the
 *      previous static "What do you want to create?" heading.
 *   2. The shared `DesktopChatInputBar`, rendered inline via the
 *      `isStatic` prop so it joins the centered stack instead of
 *      floating absolutely at the bottom of the scroll lane. The
 *      input bar still owns the Code/Plan/Image/Video/3D mode pills
 *      as part of its own chrome.
 *   3. A row of example-prompt helper buttons. Clicking a button
 *      pre-fills the textarea with a representative prompt AND
 *      switches the stream to the matching mode, mirroring the
 *      empty-state pattern in ChatGPT / Claude / Gemini.
 *
 * The whole stack is centered (vertically + horizontally) by the
 * parent `.chatEmpty` grid container — this component only owns the
 * stack itself and its width gate. Once the visitor sends a message,
 * the parent (`PublicChatView`) flips to the inline-transcript
 * layout and stops mounting this surface, so the bottom-anchored
 * input bar takes over.
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

interface ExamplePrompt {
  /** Mode to switch into when this example is clicked. */
  mode: AgentMode;
  /** Short label for the button surface. */
  label: string;
  /** Full prompt that pre-fills the textarea. */
  prompt: string;
  Icon: typeof Terminal;
}

const EXAMPLE_PROMPTS: ReadonlyArray<ExamplePrompt> = [
  {
    mode: "code",
    label: "Code an app",
    prompt:
      "Build a polished React + Tailwind to-do app with auth, persistence, and a clean responsive UI.",
    Icon: Terminal,
  },
  {
    mode: "code",
    label: "Build a website",
    prompt:
      "Build a modern marketing website for a SaaS product with a hero, feature grid, pricing, and FAQ.",
    Icon: Globe,
  },
  {
    mode: "plan",
    label: "Plan a trip",
    prompt:
      "Plan a 7-day Tokyo itinerary covering food, sights, day trips, and transit tips for first-time visitors.",
    Icon: MapPin,
  },
  {
    mode: "plan",
    label: "Research a topic",
    prompt:
      "Research the current state of solid-state batteries for EVs, including key players and a 5-year outlook.",
    Icon: BookOpen,
  },
];

export function ComposePanel({
  input,
  onInputChange,
  onSend,
  onStop,
  streamKey,
  agentId,
  defaultModel,
}: ComposePanelProps): React.ReactElement {
  const chatUI = useChatUI(streamKey);
  const { setSelectedMode } = chatUI;
  const inputBarRef = useRef<ChatInputBarHandle>(null);

  const handleSelectExample = useCallback(
    (example: ExamplePrompt) => {
      setSelectedMode(streamKey, example.mode, "chat", agentId);
      onInputChange(example.prompt);
      inputBarRef.current?.focus();
    },
    [agentId, onInputChange, setSelectedMode, streamKey],
  );

  return (
    <div
      className={styles.composePanel}
      role="region"
      aria-label="Start a new conversation"
    >
      <AgentDemoBanner />
      <div className={styles.composeInput}>
        <DesktopChatInputBar
          ref={inputBarRef}
          input={input}
          onInputChange={onInputChange}
          onSend={(content) => onSend(content)}
          onStop={onStop}
          streamKey={streamKey}
          agentId={agentId}
          defaultModel={defaultModel}
          isStatic
        />
      </div>
      <div
        className={styles.composeExamples}
        role="group"
        aria-label="Example prompts"
      >
        {EXAMPLE_PROMPTS.map(({ mode, label, prompt, Icon }) => (
          <button
            key={label}
            type="button"
            className={styles.composeExample}
            onMouseDown={(e) => {
              e.preventDefault();
            }}
            onClick={() =>
              handleSelectExample({ mode, label, prompt, Icon })
            }
            title={prompt}
          >
            <span className={styles.composeExampleIcon} aria-hidden="true">
              <Icon size={14} />
            </span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
