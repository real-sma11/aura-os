import { useCallback, useRef } from "react";
import { Box, Image as ImageIcon, ListChecks, Terminal, Video } from "lucide-react";
import {
  DesktopChatInputBar,
  type ChatInputBarHandle,
} from "../../features/chat-ui/ChatInputBar";
import { type AgentMode } from "../../constants/modes";
import { useChatUI } from "../../stores/chat-ui-store";
import styles from "./LoggedOutShell.module.css";

/**
 * Inline empty-state compose surface for the logged-out chat view.
 * Renders, top-to-bottom:
 *   1. The compose heading ("What do you want to create?").
 *   2. The shared `DesktopChatInputBar` (which already exposes the
 *      Code/Plan/Image/Video/3D mode pills as part of its own
 *      chrome).
 *   3. A row of example-prompt buttons. Clicking a button pre-fills
 *      the textarea with a representative prompt AND switches the
 *      stream to the matching mode, mirroring the empty-state
 *      pattern in ChatGPT / Claude / Gemini.
 *
 * The whole stack is centered (vertically + horizontally) by the
 * parent `.chatEmpty` grid container — this component only owns the
 * stack itself and its width gate. Once the visitor sends a message,
 * the parent (`LoggedOutChatView`) flips to the inline-transcript
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

/**
 * One example per mode so the row doubles as an at-a-glance tour of
 * what the surface can do. Order matches `AGENT_MODE_ORDER` so the
 * row reads identically to the in-bar mode pills above it.
 */
const EXAMPLE_PROMPTS: ReadonlyArray<ExamplePrompt> = [
  {
    mode: "code",
    label: "Build a landing page",
    prompt:
      "Build a modern landing page for a SaaS startup using React and Tailwind, with a hero, feature grid, and pricing section.",
    Icon: Terminal,
  },
  {
    mode: "plan",
    label: "Plan a 7-day Tokyo trip",
    prompt:
      "Plan a 7-day Tokyo itinerary covering food, sights, day trips, and transit tips for first-time visitors.",
    Icon: ListChecks,
  },
  {
    mode: "image",
    label: "Generate an image",
    prompt:
      "An astronaut riding a horse on Mars, cinematic lighting, photorealistic.",
    Icon: ImageIcon,
  },
  {
    mode: "video",
    label: "Generate a video",
    prompt:
      "A timelapse of clouds rolling over a coastal city at sunset, slow zoom, cinematic.",
    Icon: Video,
  },
  {
    mode: "3d",
    label: "Generate a 3D model",
    prompt: "A low-poly castle on a misty hill, soft pastel palette.",
    Icon: Box,
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
}: ComposePanelProps) {
  const chatUI = useChatUI(streamKey);
  const { setSelectedMode } = chatUI;
  const inputBarRef = useRef<ChatInputBarHandle>(null);

  const handleSelectExample = useCallback(
    (example: ExamplePrompt) => {
      // Switch to the example's mode first so the input bar's
      // segmented control reflects the new selection on the same
      // render that the textarea fills. The third arg ("chat") and
      // fourth (`agentId`) match the `setSelectedMode` signature in
      // the chat-ui store; passing them here keeps the public
      // surface consistent with the authenticated mode-pill
      // behaviour.
      setSelectedMode(streamKey, example.mode, "chat", agentId);
      onInputChange(example.prompt);
      // Move focus into the textarea so the visitor can immediately
      // tweak the prompt (or hit Enter to send) without an extra
      // click. Mirrors the in-bar mode-pill behaviour.
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
      <h2 className={styles.composeHeading}>What do you want to create?</h2>
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
        />
      </div>
      <div
        className={styles.composeExamples}
        role="group"
        aria-label="Example prompts"
      >
        {EXAMPLE_PROMPTS.map(({ mode, label, prompt, Icon }) => (
          <button
            key={mode}
            type="button"
            className={styles.composeExample}
            onMouseDown={(e) => {
              // Don't let the button steal focus from the textarea
              // on mousedown; the click handler below explicitly
              // refocuses, so the user's caret lands in the
              // textarea right after the prompt is filled.
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
