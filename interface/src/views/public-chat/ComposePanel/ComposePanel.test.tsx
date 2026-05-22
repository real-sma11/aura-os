/**
 * Focus-handoff tests for the public compose surface. The bottom
 * mode-pill widgets (Chat / Plan / Create an image / etc.) must keep
 * the chat textarea focused after a click so the visitor can start
 * typing immediately. Plain `<button>`s steal focus on mousedown by
 * default, so the widget needs both a `preventDefault` on mousedown
 * AND an explicit `inputBarRef.focus()` call on click — the test
 * exercises both code paths.
 */

import { forwardRef, useImperativeHandle, useRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSetSelectedMode = vi.fn();
let mockSelectedMode: "code" | "plan" | "image" | "3d" | "video" = "code";

vi.mock("../../../stores/chat-ui-store", () => ({
  useChatUI: () => ({
    selectedMode: mockSelectedMode,
    setSelectedMode: mockSetSelectedMode,
  }),
}));

vi.mock("./ComposePanel.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../AgentDemoBanner", () => ({
  AgentDemoBanner: () => <div data-testid="agent-demo-banner-stub" />,
}));

vi.mock("../../../features/chat-ui/ChatInputBar", () => {
  interface StubProps {
    input: string;
    onInputChange: (next: string) => void;
    onSend: (content: string) => void;
  }
  interface StubHandle {
    focus: () => void;
    isFocused?: () => boolean;
  }
  const DesktopChatInputBar = forwardRef<StubHandle, StubProps>(
    function StubInputBar({ input, onInputChange, onSend }, ref) {
      const textareaRef = useRef<HTMLTextAreaElement>(null);
      useImperativeHandle(ref, () => ({
        focus: () => textareaRef.current?.focus(),
        isFocused: () =>
          document.activeElement === textareaRef.current,
      }));
      return (
        <div data-testid="chat-input-bar-stub">
          <textarea
            ref={textareaRef}
            aria-label="Compose"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
          />
          <button type="button" onClick={() => onSend(input)}>
            Send
          </button>
        </div>
      );
    },
  );
  return { DesktopChatInputBar };
});

import { ComposePanel } from "./ComposePanel";

function renderPanel() {
  return render(
    <ComposePanel
      input=""
      onInputChange={vi.fn()}
      onSend={vi.fn()}
      onStop={vi.fn()}
      streamKey="test-stream"
      agentId="agent-1"
      defaultModel="aura-claude-sonnet-4-6"
    />,
  );
}

beforeEach(() => {
  mockSetSelectedMode.mockClear();
  mockSelectedMode = "code";
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ComposePanel mode widgets", () => {
  it("focuses the compose textarea after a mode-widget click", async () => {
    const user = userEvent.setup();
    renderPanel();

    const textarea = screen.getByLabelText("Compose");
    expect(document.activeElement).not.toBe(textarea);

    await user.click(
      screen.getByRole("button", { name: /Plan a trip/i }),
    );

    expect(mockSetSelectedMode).toHaveBeenCalledWith(
      "test-stream",
      "plan",
      "chat",
      "agent-1",
    );
    expect(document.activeElement).toBe(textarea);
  });

  it("keeps the textarea focused when the widget is clicked while typing", async () => {
    const user = userEvent.setup();
    renderPanel();

    const textarea = screen.getByLabelText("Compose");
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    await user.click(
      screen.getByRole("button", { name: /Research a topic/i }),
    );
    expect(document.activeElement).toBe(textarea);
  });
});
