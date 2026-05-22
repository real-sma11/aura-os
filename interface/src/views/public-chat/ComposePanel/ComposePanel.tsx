import { BookOpen, Globe, MapPin, Terminal } from "lucide-react";
import { MockAuraApp } from "../MockAuraApp";
import styles from "./ComposePanel.module.css";

/**
 * Empty-state hero stack for the public chat view. Mounts the
 * decorative `MockAuraApp` (titlebar + wallpaper video + scripted DM
 * windows + decorative taskbar) and passes the example-prompt pills
 * into its `inputDock` slot so the pills read as part of the windowed
 * Aura app's chrome rather than as a free-floating row.
 *
 * The actual `PublicComposeInput` is rendered by `PublicChatView`
 * in its bottom-anchored `.inputBarSlot` (the SAME slot used by the
 * populated transcript layout) so the rounded input pill is pinned
 * to the bottom of the screen in both empty and populated states.
 * That symmetry eliminates any layout jump in the input's vertical
 * position when the visitor sends their first message.
 *
 * Phase 5: the public input no longer carries a mode selector, so
 * the example pills no longer flip the per-stream `selectedMode` —
 * they only pre-fill the textarea now. The parent dispatch path
 * (see `usePublicChat`) defaults to plain chat (`code` behavior)
 * regardless of which pill the visitor clicked.
 */
export interface ComposePanelProps {
  /**
   * Routed up to the parent so clicking an example-prompt pill can
   * pre-fill the floating `PublicComposeInput`'s textarea AND
   * forward focus to it. The input bar itself is not mounted inside
   * `ComposePanel` — the parent owns both the input state and the
   * input-bar ref.
   */
  onSelectExample: (prompt: string) => void;
}

interface ExamplePrompt {
  /** Short label for the button surface. */
  label: string;
  /** Full prompt that pre-fills the textarea. */
  prompt: string;
  Icon: typeof Terminal;
}

const EXAMPLE_PROMPTS: ReadonlyArray<ExamplePrompt> = [
  {
    label: "Code an app",
    prompt:
      "Build a polished React + Tailwind to-do app with auth, persistence, and a clean responsive UI.",
    Icon: Terminal,
  },
  {
    label: "Build a website",
    prompt:
      "Build a modern marketing website for a SaaS product with a hero, feature grid, pricing, and FAQ.",
    Icon: Globe,
  },
  {
    label: "Plan a trip",
    prompt:
      "Plan a 7-day Tokyo itinerary covering food, sights, day trips, and transit tips for first-time visitors.",
    Icon: MapPin,
  },
  {
    label: "Research a topic",
    prompt:
      "Research the current state of solid-state batteries for EVs, including key players and a 5-year outlook.",
    Icon: BookOpen,
  },
];

export function ComposePanel({
  onSelectExample,
}: ComposePanelProps): React.ReactElement {
  const examples = (
    <div
      className={styles.composeExamples}
      role="group"
      aria-label="Example prompts"
    >
      {EXAMPLE_PROMPTS.map(({ label, prompt, Icon }) => (
        <button
          key={label}
          type="button"
          className={styles.composeExample}
          onMouseDown={(e) => {
            e.preventDefault();
          }}
          onClick={() => onSelectExample(prompt)}
          title={prompt}
        >
          <span className={styles.composeExampleIcon} aria-hidden="true">
            <Icon size={14} />
          </span>
          <span>{label}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div
      className={styles.composePanel}
      role="region"
      aria-label="Start a new conversation"
    >
      <MockAuraApp inputDock={examples} />
    </div>
  );
}
