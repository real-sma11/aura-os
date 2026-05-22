/**
 * Hand-authored timeline that drives the logged-out homepage banner
 * (`AgentDemoBanner`). Stays a pure data module — no React, no DOM —
 * so it's trivially unit-testable and the banner component can stay
 * a thin renderer over `SCRIPT`.
 *
 * The scenario walks three agents through the smallest believable
 * end-to-end "ship a feature" loop: an Architect plans the work, a
 * Frontend agent writes the JSX, and a Reviewer rubber-stamps the
 * green build. Total wall-clock for one pass is ~22 seconds; the
 * banner restarts from the top once `SCRIPT` is exhausted so visitors
 * who linger see a continuous demo instead of a frozen final frame.
 *
 * Frame durations are the *time the resolved frame is the latest
 * entry on screen* (not the typing duration of the message it
 * represents). When a frame declares `typingMs`, the row first shows
 * a typing indicator for that many ms inside the same row, then the
 * row's bubble morphs into the resolved content — so a typing beat
 * and its message render as ONE entry that swaps content, not two
 * stacked rows. The script-level wall-clock for a frame with typing
 * is therefore `typingMs + durationMs`.
 *
 * Older frames keep rendering above the latest one until they scroll
 * out of the visible window — see `AgentDemoBanner.tsx` for the
 * windowing logic.
 */

import {
  BadgeCheck,
  Code2,
  Compass,
  type LucideIcon,
} from "lucide-react";

export type AgentId = "architect" | "frontend" | "reviewer";

export interface AgentMeta {
  readonly id: AgentId;
  /** Short label rendered next to messages and tool cards. */
  readonly name: string;
  /**
   * Role-evocative icon rendered inside the avatar circle. Picked
   * from `lucide-react` so the asset travels with the rest of the
   * UI's icon set (no extra image fetches, scales cleanly with the
   * avatar size, inherits `currentColor`).
   */
  readonly Icon: LucideIcon;
  /** Primary accent color used for the agent name + tool border. */
  readonly color: string;
  /**
   * Two stops used by the avatar's diagonal gradient. `from` lands at
   * the top-left and `to` at the bottom-right so each agent reads as
   * a small jewel rather than a flat color disc, while still keeping
   * the agent's primary `color` recognizable as the dominant hue.
   */
  readonly gradient: {
    readonly from: string;
    readonly to: string;
  };
}

export const AGENTS: Readonly<Record<AgentId, AgentMeta>> = {
  architect: {
    id: "architect",
    name: "Architect",
    Icon: Compass,
    color: "#c084fc",
    gradient: { from: "#d8b4fe", to: "#7c3aed" },
  },
  frontend: {
    id: "frontend",
    name: "Frontend",
    Icon: Code2,
    color: "#ff6fb5",
    gradient: { from: "#ffa3cf", to: "#db2777" },
  },
  reviewer: {
    id: "reviewer",
    name: "Reviewer",
    Icon: BadgeCheck,
    color: "#6ee7d7",
    gradient: { from: "#a7f3d0", to: "#0d9488" },
  },
};

/**
 * Common fields for every script frame. `typingMs`, when set,
 * triggers the row to first render the `TypingIndicator` for that
 * many milliseconds before its resolved content (message text or
 * tool card) cross-fades into place. Frames that should appear
 * instantly omit `typingMs` (or set it to 0).
 */
interface BaseFrame {
  readonly agent: AgentId;
  /**
   * Optional pre-roll: render typing dots inside the row for this
   * many ms before revealing the resolved content. Omit / 0 means
   * the resolved content shows immediately when the row enters.
   */
  readonly typingMs?: number;
  /**
   * Milliseconds the *resolved* content stays as the latest frame
   * before the script advances to the next entry. Wall-clock dwell
   * for the frame as a whole is `(typingMs ?? 0) + durationMs`.
   */
  readonly durationMs: number;
}

export interface MessageFrame extends BaseFrame {
  readonly kind: "message";
  readonly text: string;
}

export interface ToolFrame extends BaseFrame {
  readonly kind: "tool";
  /** Short label rendered as the card header (e.g. "edit_file"). */
  readonly toolName: string;
  /** Optional second label to the right of `toolName` (e.g. a path). */
  readonly target?: string;
  /** Mono-font multi-line body. Each entry renders on its own line. */
  readonly preview: ReadonlyArray<string>;
}

export type DemoFrame = MessageFrame | ToolFrame;

/**
 * The curated timeline. Keep individual frames short (< 90 chars for
 * messages, ≤ 6 lines for tool previews) so they render cleanly inside
 * the 680 × 360 banner without wrapping into ugly multi-line bubbles.
 *
 * Beats that previously stood alone as `kind: "typing"` entries are
 * now folded into the following message/tool via `typingMs` — the row
 * shows the typing indicator first, then morphs in place into its
 * resolved content. The wall-clock of one full loop matches the prior
 * version because `typingMs + durationMs` reproduces the old
 * "typing.durationMs + message.durationMs" sum.
 */
export const SCRIPT: ReadonlyArray<DemoFrame> = [
  {
    kind: "message",
    agent: "architect",
    text: "Let's ship the new pricing page. I'll break it into tasks.",
    // 1500ms holds the indicator long enough for ~2 full bounce
    // cycles of the dots' 800ms keyframe — short typing beats (~500-
    // 700ms) read as a flash and obscured the up/down motion, which
    // was the user-reported gap. The same reasoning drives the
    // longer values on the other typing-led frames below; tool-led
    // frames stay slightly shorter because they precede a card
    // mount rather than a streamed message.
    typingMs: 1500,
    durationMs: 2200,
  },
  {
    kind: "tool",
    agent: "architect",
    toolName: "plan",
    target: "pricing.todo",
    preview: [
      "1. Hero + tagline",
      "2. Tier cards (3)",
      "3. FAQ section",
      "4. Wire CTA -> /signup",
    ],
    durationMs: 2400,
  },
  {
    kind: "message",
    agent: "frontend",
    text: "On it. Building the tier cards first.",
    typingMs: 1400,
    durationMs: 1900,
  },
  {
    kind: "tool",
    agent: "frontend",
    toolName: "edit_file",
    target: "PricingTiers.tsx",
    preview: [
      "+ <Tier name=\"Starter\" price={0} />",
      "+ <Tier name=\"Pro\" price={20} highlight />",
      "+ <Tier name=\"Team\" price={99} />",
    ],
    durationMs: 2800,
  },
  {
    kind: "tool",
    agent: "frontend",
    toolName: "bash",
    target: "npm run build",
    preview: [
      "vite v5.4.10 building for production...",
      "transformed 142 modules.",
      "dist/index.html  1.2 kB | gzip: 0.6 kB",
      "build succeeded in 4.8s",
    ],
    typingMs: 1100,
    durationMs: 2600,
  },
  {
    kind: "message",
    agent: "reviewer",
    text: "Build is green and the tier copy looks clean. Approving.",
    typingMs: 1300,
    durationMs: 2400,
  },
  {
    kind: "tool",
    agent: "reviewer",
    toolName: "merge",
    target: "feat/pricing-page",
    preview: ["+ 3 files changed, 84 insertions(+)", "merged to main."],
    durationMs: 2200,
  },
  {
    kind: "message",
    agent: "architect",
    text: "Shipped. Next: a marketing post for the launch?",
    durationMs: 2400,
  },
];
