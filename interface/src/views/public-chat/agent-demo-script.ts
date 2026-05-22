/**
 * Hand-authored timeline that drives the logged-out homepage hero
 * (`MockAuraApp`). Stays a pure data module — no React, no DOM —
 * so it's trivially unit-testable and the hero component can stay a
 * thin renderer over `SCRIPT`.
 *
 * The scenario walks four agents through a "ship a feature" loop
 * across multiple parallel DM threads — an Architect coordinates a
 * Frontend (tier cards) and a Backend (pricing endpoint + migration)
 * agent in two separate windows, then a Reviewer signs off the work
 * in two more. Total wall-clock for one pass is ~45 seconds; the
 * hero restarts from the top once `SCRIPT` is exhausted so visitors
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
 * Each frame is tagged with a `thread` id so the renderer can route
 * it into one of several floating DM windows (MSN/ICQ-style). A
 * thread's window mounts the first time it receives a frame, then
 * subsequent frames for that thread append messages inside the same
 * window. Threads are 1:1 conversations between two agents — the
 * agent identified by `frame.agent` is the speaker and the other
 * participant from `THREADS[id].participants` is the listener.
 *
 * Tool frames may declare a `language` (any `highlight.js/lib/common`
 * language id, e.g. `typescript`, `sql`, `bash`) which makes
 * `TerminalStream` syntax-highlight the preview lines with the theme
 * stylesheet (github / github-dark, swapped by `HighlightThemeBridge`
 * on theme change). Frames that aren't really code (e.g. the
 * Architect's plan checklist) leave `language` omitted and render as
 * plain text.
 */

import {
  BadgeCheck,
  Code2,
  Compass,
  Database,
  type LucideIcon,
} from "lucide-react";

export type AgentId = "architect" | "frontend" | "backend" | "reviewer";

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
  // Backend uses an amber accent so it reads distinctly against the
  // existing purple (architect) / pink (frontend) / teal (reviewer)
  // trio — none of the other agents share its warm hue, so the eye
  // can quickly tell which agent is currently typing without
  // reading the name label.
  backend: {
    id: "backend",
    name: "Backend",
    Icon: Database,
    color: "#fbbf24",
    gradient: { from: "#fde68a", to: "#d97706" },
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
 * Stable identifier for a 1:1 DM thread between two agents. The
 * renderer mounts one floating chat window per thread and routes
 * every script frame into the window matching `frame.thread`.
 */
export type ThreadId =
  | "architect_frontend"
  | "architect_backend"
  | "backend_reviewer"
  | "frontend_reviewer";

export interface ThreadMeta {
  readonly id: ThreadId;
  /**
   * Tuple of the two agents whose messages flow through this thread.
   * The tuple order also determines the alignment of message bubbles
   * inside the window — the first participant's bubbles render on
   * the left, the second participant's on the right, mirroring the
   * "you / them" split used by classic IM clients.
   */
  readonly participants: readonly [AgentId, AgentId];
  /** Short title rendered in the DM window's titlebar. */
  readonly title: string;
}

export const THREADS: Readonly<Record<ThreadId, ThreadMeta>> = {
  architect_frontend: {
    id: "architect_frontend",
    participants: ["architect", "frontend"],
    title: "Architect · Frontend",
  },
  architect_backend: {
    id: "architect_backend",
    participants: ["architect", "backend"],
    title: "Architect · Backend",
  },
  backend_reviewer: {
    id: "backend_reviewer",
    participants: ["backend", "reviewer"],
    title: "Backend · Reviewer",
  },
  frontend_reviewer: {
    id: "frontend_reviewer",
    participants: ["frontend", "reviewer"],
    title: "Frontend · Reviewer",
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
  /** DM window the frame renders inside. */
  readonly thread: ThreadId;
  /** Speaker — must be one of the thread's two participants. */
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
   *
   * For tool frames whose preview is rendered through
   * `TerminalStream`, `durationMs` should be sized to cover the
   * per-character streaming time of the preview plus a brief dwell
   * at the end so the user can read the resolved output — the
   * defaults in `TerminalStream` (~14ms/char + 90ms inter-line
   * pause) stream ~70 chars/second, so a 6-line snippet of ~135
   * chars finishes streaming in ~2.4s and a 3200ms `durationMs`
   * leaves ~800ms of post-stream dwell.
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
  /**
   * Optional `highlight.js` language id (e.g. `"typescript"`,
   * `"sql"`, `"bash"`). When set, `TerminalStream` pre-highlights
   * each preview line via `hljs.highlight(line, { language })` and
   * reveals the resulting tokens char-by-char so the theme
   * stylesheet (github / github-dark, swapped automatically by
   * `HighlightThemeBridge`) colors keywords / strings / types
   * matching whichever theme is active. Omit for non-code previews
   * (e.g. plan checklists, merge summaries) where highlighting
   * would mis-classify the text and look noisy.
   */
  readonly language?: string;
}

export type DemoFrame = MessageFrame | ToolFrame;

/**
 * The curated timeline. Frames are ordered to interleave the four
 * DM threads — a viewer watching the hero will see the Architect
 * kick off two parallel threads (one with Frontend, one with
 * Backend), each thread fills with messages + tool calls, and then
 * a Reviewer thread opens to sign off the build.
 *
 * Keep individual frames short (< 90 chars for messages, ≤ 6 lines
 * for tool previews) so they render cleanly inside the small DM
 * windows without wrapping into ugly multi-line bubbles.
 */
export const SCRIPT: ReadonlyArray<DemoFrame> = [
  {
    kind: "message",
    thread: "architect_frontend",
    agent: "architect",
    text: "Shipping the pricing page today. Can you take the tier cards?",
    typingMs: 1500,
    durationMs: 2200,
  },
  {
    kind: "message",
    thread: "architect_backend",
    agent: "architect",
    text: "Need a /pricing endpoint and a migration on your side.",
    typingMs: 1300,
    durationMs: 2000,
  },
  {
    kind: "tool",
    thread: "architect_frontend",
    agent: "architect",
    toolName: "plan",
    target: "pricing.todo",
    preview: [
      "1. Hero + tagline",
      "2. Tier cards (3)",
      "3. Wire CTA -> /signup",
      "4. FAQ section",
    ],
    durationMs: 2400,
  },
  {
    kind: "message",
    thread: "architect_frontend",
    agent: "frontend",
    text: "On it. Building the tier cards first.",
    typingMs: 1200,
    durationMs: 1800,
  },
  {
    kind: "message",
    thread: "architect_backend",
    agent: "backend",
    text: "Wiring the pricing endpoint and migration in parallel.",
    typingMs: 1300,
    durationMs: 1900,
  },
  {
    kind: "tool",
    thread: "architect_frontend",
    agent: "frontend",
    toolName: "edit_file",
    target: "PricingTiers.tsx",
    preview: [
      "interface TierProps {",
      "  name: string;",
      "  price: number;",
      "  highlight?: boolean;",
      "}",
      "const Tier = ({ name, price }: TierProps) =>",
      "  <Card>{name} — ${price}/mo</Card>;",
    ],
    language: "typescript",
    durationMs: 3200,
  },
  {
    kind: "tool",
    thread: "architect_backend",
    agent: "backend",
    toolName: "edit_file",
    target: "api/pricing.ts",
    preview: [
      "const Pricing = z.object({",
      "  name: z.string(),",
      "  price: z.number().int(),",
      "});",
      "app.get(\"/pricing\", async (_, res) =>",
      "  res.json(await db.tier.findMany()));",
    ],
    language: "typescript",
    durationMs: 3000,
  },
  {
    kind: "tool",
    thread: "architect_backend",
    agent: "backend",
    toolName: "edit_file",
    target: "migrations/0001_pricing.sql",
    preview: [
      "CREATE TABLE pricing_tier (",
      "  id SERIAL PRIMARY KEY,",
      "  name TEXT NOT NULL,",
      "  price INTEGER NOT NULL,",
      "  highlight BOOLEAN DEFAULT false",
      ");",
    ],
    language: "sql",
    durationMs: 3000,
  },
  {
    kind: "message",
    thread: "backend_reviewer",
    agent: "backend",
    text: "Pricing API is live and tests pass. Ready for review.",
    typingMs: 1200,
    durationMs: 2000,
  },
  {
    kind: "tool",
    thread: "backend_reviewer",
    agent: "backend",
    toolName: "bash",
    target: "pytest tests/test_pricing.py",
    preview: [
      "collected 8 items",
      "tests/test_pricing.py ........ [100%]",
      "============== 8 passed in 0.42s ===============",
    ],
    language: "bash",
    durationMs: 2400,
  },
  {
    kind: "tool",
    thread: "frontend_reviewer",
    agent: "frontend",
    toolName: "bash",
    target: "npm run build",
    preview: [
      "vite v5.4.10 building for production...",
      "transformed 142 modules.",
      "dist/index.html  1.2 kB | gzip: 0.6 kB",
      "build succeeded in 4.8s",
    ],
    language: "bash",
    typingMs: 900,
    durationMs: 2400,
  },
  {
    kind: "message",
    thread: "frontend_reviewer",
    agent: "reviewer",
    text: "Build is green and the tier copy looks clean. Approving.",
    typingMs: 1300,
    durationMs: 2200,
  },
  {
    kind: "tool",
    thread: "backend_reviewer",
    agent: "reviewer",
    toolName: "merge",
    target: "feat/pricing-page",
    preview: ["3 files changed, 84 insertions(+)", "merged to main."],
    typingMs: 800,
    durationMs: 2200,
  },
  {
    kind: "message",
    thread: "architect_frontend",
    agent: "architect",
    text: "Shipped. Marketing post next?",
    typingMs: 1100,
    durationMs: 2200,
  },
];
