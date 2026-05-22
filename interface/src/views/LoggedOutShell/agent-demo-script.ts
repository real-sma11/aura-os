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
 * Frame durations are the *time the frame is the latest entry on
 * screen* (not the typing duration of the message it represents).
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

export interface MessageFrame {
  readonly kind: "message";
  readonly agent: AgentId;
  readonly text: string;
  readonly durationMs: number;
}

export interface TypingFrame {
  readonly kind: "typing";
  readonly agent: AgentId;
  readonly durationMs: number;
}

export interface ToolFrame {
  readonly kind: "tool";
  readonly agent: AgentId;
  /** Short label rendered as the card header (e.g. "edit_file"). */
  readonly toolName: string;
  /** Optional second label to the right of `toolName` (e.g. a path). */
  readonly target?: string;
  /** Mono-font multi-line body. Each entry renders on its own line. */
  readonly preview: ReadonlyArray<string>;
  readonly durationMs: number;
}

export type DemoFrame = MessageFrame | TypingFrame | ToolFrame;

/**
 * The curated timeline. Keep individual frames short (< 90 chars for
 * messages, ≤ 6 lines for tool previews) so they render cleanly inside
 * the 680 × 360 banner without wrapping into ugly multi-line bubbles.
 */
export const SCRIPT: ReadonlyArray<DemoFrame> = [
  { kind: "typing", agent: "architect", durationMs: 700 },
  {
    kind: "message",
    agent: "architect",
    text: "Let's ship the new pricing page. I'll break it into tasks.",
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
  { kind: "typing", agent: "frontend", durationMs: 600 },
  {
    kind: "message",
    agent: "frontend",
    text: "On it. Building the tier cards first.",
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
  { kind: "typing", agent: "frontend", durationMs: 500 },
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
    durationMs: 2600,
  },
  { kind: "typing", agent: "reviewer", durationMs: 600 },
  {
    kind: "message",
    agent: "reviewer",
    text: "Build is green and the tier copy looks clean. Approving.",
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
