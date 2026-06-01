/**
 * Hand-authored conversations that drive the `/product` page's
 * `AgentChatSection` phone mockups. Each conversation is a single
 * 1:1 thread between the visitor ("you") and one AURA agent, so the
 * phones read like a mobile messaging app: your prompts on the
 * right, the agent's typing / streamed replies / tool cards on the
 * left.
 *
 * This is the mobile cousin of the desktop hero's
 * `views/public-chat/agent-demo-script.ts` (which scripts
 * agent-to-agent DM threads). We deliberately reuse that module's
 * `AGENTS` palette and `MessageFrame` / `ToolFrame` shapes so the
 * product page stays visually consistent with the landing demo,
 * and only layer on a `from` field (which side of the thread the
 * frame sits on) plus a lightweight conversation wrapper.
 *
 * Stays a pure data module (no React, no DOM) so `MockMobileChat`
 * can remain a thin renderer/looper over these arrays.
 *
 * Keep messages short (< ~70 chars) and tool previews to <= 6 short
 * lines so bubbles render cleanly inside the narrow phone screen
 * without wrapping into tall multi-line blocks.
 */

import {
  AGENTS,
  type AgentId,
  type MessageFrame,
  type ToolFrame,
} from "../../public-chat/agent-demo-script";

/**
 * Which side of the thread a frame belongs to. `"user"` frames are
 * the visitor's prompts (right-aligned, no typing pre-roll); all
 * other frames are the agent's replies (left-aligned, may carry a
 * `typingMs` pre-roll).
 */
export type MobileSpeaker = "user" | "agent";

/**
 * A single message bubble in a mobile thread. Reuses the landing
 * demo's `MessageFrame` (text + optional `typingMs` pre-roll +
 * `durationMs` dwell) and tags it with the speaker side.
 */
export type MobileMessageFrame = MessageFrame & { readonly from: MobileSpeaker };

/**
 * A tool card in a mobile thread — always the agent's side. Reuses
 * the landing demo's `ToolFrame` (tool name + optional target +
 * streamed preview lines + optional hljs language).
 */
export type MobileToolFrame = ToolFrame & { readonly from: "agent" };

export type MobileFrame = MobileMessageFrame | MobileToolFrame;

export interface MobileConversation {
  /** Stable id (used as the React key for the phone instance). */
  readonly id: string;
  /** The agent the visitor is texting — drives header + accent. */
  readonly agentId: AgentId;
  /** Small status line under the agent name in the header. */
  readonly subtitle: string;
  /**
   * Accent color for this phone, taken from the AURA theme palette
   * (the same swatches offered in Settings -> Appearance). Each phone
   * uses a distinct accent so the trio reads as three separate
   * conversations; this overrides the shared `AGENTS[agentId].color`
   * locally so the desktop landing hero keeps its own palette.
   */
  readonly accent: string;
  /** Ordered timeline of bubbles + tool cards. */
  readonly frames: ReadonlyArray<MobileFrame>;
}

/**
 * AURA theme accent colors (mirrors the dark-mode swatches in
 * `SettingsView/AppearanceSection`). Assigned to the phones in
 * left/center/right order.
 */
const ACCENT_CYAN = "#01f4cb";
const ACCENT_BLUE = "#3b82f6";
const ACCENT_PURPLE = "#a855f7";

/**
 * Helper so frame literals below stay terse — `thread`/`agent` from
 * the original `BaseFrame` are irrelevant for a single linear mobile
 * thread, so we stub them to a constant and let `from` + the
 * conversation's `agentId` carry the routing/identity instead.
 */
function userMessage(
  text: string,
  durationMs: number,
): MobileMessageFrame {
  return {
    kind: "message",
    from: "user",
    thread: "architect_frontend",
    agent: "architect",
    text,
    durationMs,
  };
}

function agentMessage(
  agent: AgentId,
  text: string,
  typingMs: number,
  durationMs: number,
): MobileMessageFrame {
  return {
    kind: "message",
    from: "agent",
    thread: "architect_frontend",
    agent,
    text,
    typingMs,
    durationMs,
  };
}

function agentTool(
  agent: AgentId,
  toolName: string,
  target: string,
  preview: ReadonlyArray<string>,
  durationMs: number,
  language?: string,
): MobileToolFrame {
  return {
    kind: "tool",
    from: "agent",
    thread: "architect_frontend",
    agent,
    toolName,
    target,
    preview,
    language,
    durationMs,
  };
}

/**
 * Phone 1 (left, md) — texting the Frontend agent to build a UI
 * affordance. Shows a prompt, a typed reply, and an `edit_file`
 * tool card streaming TypeScript.
 */
const FRONTEND_CHAT: MobileConversation = {
  id: "frontend",
  agentId: "frontend",
  subtitle: "online · on your VM",
  accent: ACCENT_CYAN,
  frames: [
    userMessage("Add a dark mode toggle to settings", 1400),
    agentMessage(
      "frontend",
      "On it — adding a toggle wired to the theme store.",
      1400,
      2000,
    ),
    agentTool(
      "frontend",
      "edit_file",
      "SettingsPanel.tsx",
      [
        "<Toggle",
        "  label=\"Dark mode\"",
        "  checked={theme === 'dark'}",
        "  onChange={toggleTheme}",
        "/>",
      ],
      3000,
      "typescript",
    ),
    agentMessage("frontend", "Done. Want it to follow the OS by default?", 1200, 2400),
  ],
};

/**
 * Phone 2 (center, lg hero) — texting the Backend agent to debug a
 * slow endpoint. Prompt, reply, and a `bash` tool card streaming a
 * query plan.
 */
const BACKEND_CHAT: MobileConversation = {
  id: "backend",
  agentId: "backend",
  subtitle: "online · on your VM",
  accent: ACCENT_BLUE,
  frames: [
    userMessage("Why is /pricing slow today?", 1300),
    agentMessage(
      "backend",
      "Checking the query plan — looks like a missing index.",
      1500,
      2200,
    ),
    agentTool(
      "backend",
      "bash",
      "EXPLAIN ANALYZE",
      [
        "Seq Scan on pricing_tier",
        "  rows=48210  (actual time=812ms)",
        "Planning: 0.3ms  Execution: 812ms",
      ],
      2600,
      "bash",
    ),
    agentMessage(
      "backend",
      "Adding an index on (name). Should drop to ~5ms.",
      1300,
      2200,
    ),
    agentTool(
      "backend",
      "edit_file",
      "0002_pricing_idx.sql",
      ["CREATE INDEX idx_pricing_name", "  ON pricing_tier (name);"],
      2400,
      "sql",
    ),
  ],
};

/**
 * Phone 3 (right, md) — texting the Reviewer agent to gate a
 * release on CI. Prompt, reply, a `bash` build log, and a `merge`
 * summary.
 */
const REVIEWER_CHAT: MobileConversation = {
  id: "reviewer",
  agentId: "reviewer",
  subtitle: "online · on your VM",
  accent: ACCENT_PURPLE,
  frames: [
    userMessage("Ship the release once CI is green", 1400),
    agentMessage("reviewer", "Watching the pipeline now.", 1100, 1800),
    agentTool(
      "reviewer",
      "bash",
      "ci status",
      [
        "lint ........ passed",
        "test ........ 214 passed",
        "build ....... succeeded",
      ],
      2600,
      "bash",
    ),
    agentMessage("reviewer", "All green. Merging and tagging the release.", 1300, 2200),
    agentTool(
      "reviewer",
      "merge",
      "release/2.4.0",
      ["12 files changed", "tagged v2.4.0 · deployed"],
      2400,
    ),
  ],
};

/**
 * Conversations in phone order: side / hero / side. `AgentChatSection`
 * passes index 0 to the left phone, 1 to the center hero, 2 to the
 * right phone.
 */
export const MOBILE_CONVERSATIONS: ReadonlyArray<MobileConversation> = [
  FRONTEND_CHAT,
  BACKEND_CHAT,
  REVIEWER_CHAT,
];

/** Re-export the shared agent palette for the renderer's convenience. */
export { AGENTS };
