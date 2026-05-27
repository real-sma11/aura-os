/**
 * Phase 3 — public chat parity. The previous plain-text bubble
 * rendering bypassed `LLMOutput` entirely, so public-chat assistant
 * turns never got the standard `ActivityTimeline` / `Block` chrome
 * that every authenticated LLM surface uses. These tests pin the
 * new contract: assistant code/plan messages now route through
 * `LLMOutput`, user messages keep their plain-text appearance, and
 * media variants keep the existing placeholder text (full media
 * surfacing remains future work — see PublicChatBubble's source
 * comment for the rationale).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PublicMessage } from "../../../stores/public-chat-store";

// Mock `LLMOutput` so we can detect that the assistant path routes
// through the shared component without dragging in
// `ActivityTimeline` / `SegmentedContent` / `ReactMarkdown` (which
// pull in highlight.js and other heavy deps that aren't needed for
// this focused chrome-routing assertion).
vi.mock("../../../apps/chat/components/LLMOutput", () => ({
  LLMOutput: ({
    content,
    isStreaming,
  }: {
    content: string;
    isStreaming?: boolean;
  }) => (
    <div
      data-testid="llm-output-stub"
      data-streaming={String(isStreaming ?? false)}
    >
      {content}
    </div>
  ),
}));

vi.mock("./PublicChatBubble.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { PublicChatBubble } from "./PublicChatBubble";

function userMsg(content: string): PublicMessage {
  return { id: "u1", role: "user", content };
}

function assistantCodeMsg(content: string): PublicMessage {
  return { id: "a1", role: "assistant", mode: "code", content };
}

function assistantPlanMsg(content: string): PublicMessage {
  return { id: "a2", role: "assistant", mode: "plan", content };
}

function assistantImageMsg(prompt: string, url: string): PublicMessage {
  return { id: "a3", role: "assistant", mode: "image", prompt, url };
}

describe("PublicChatBubble", () => {
  it("renders user messages as plain text (no LLMOutput route)", () => {
    render(<PublicChatBubble message={userMsg("hello aura")} isStreaming={false} />);
    expect(screen.getByText("hello aura")).toBeInTheDocument();
    expect(screen.queryByTestId("llm-output-stub")).not.toBeInTheDocument();
  });

  it("routes assistant code messages through LLMOutput", () => {
    render(
      <PublicChatBubble
        message={assistantCodeMsg("Hello from Aura")}
        isStreaming={false}
      />,
    );
    const stub = screen.getByTestId("llm-output-stub");
    expect(stub).toBeInTheDocument();
    expect(stub).toHaveTextContent("Hello from Aura");
    expect(stub).toHaveAttribute("data-streaming", "false");
  });

  it("routes assistant plan messages through LLMOutput", () => {
    render(
      <PublicChatBubble
        message={assistantPlanMsg("Step 1: plan")}
        isStreaming={false}
      />,
    );
    const stub = screen.getByTestId("llm-output-stub");
    expect(stub).toHaveTextContent("Step 1: plan");
  });

  it("forwards isStreaming=true to LLMOutput so the live-stream chrome engages on the in-flight turn", () => {
    render(
      <PublicChatBubble
        message={assistantCodeMsg("partial...")}
        isStreaming
      />,
    );
    const stub = screen.getByTestId("llm-output-stub");
    expect(stub).toHaveAttribute("data-streaming", "true");
  });

  it("renders the media placeholder string for assistant image messages (no LLMOutput route)", () => {
    render(
      <PublicChatBubble
        message={assistantImageMsg("a cyberpunk skyline", "https://cdn/img.png")}
        isStreaming={false}
      />,
    );
    expect(
      screen.getByText("image generated from: a cyberpunk skyline"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("llm-output-stub")).not.toBeInTheDocument();
  });
});
