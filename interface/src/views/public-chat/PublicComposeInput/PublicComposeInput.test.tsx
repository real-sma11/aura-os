/**
 * Behavioural test for `PublicComposeInput` — the stripped-down,
 * pill-shaped compose input dedicated to the public (logged-out)
 * chat surface. Pins the four contracts the public chat view relies
 * on:
 *
 *  1. The placeholder copy renders so visitors see the public-mode
 *     hint ("Ask anything privately…") rather than nothing on first
 *     paint.
 *  2. Typing into the textarea fires `onInputChange` with the new
 *     value (the parent owns the input string).
 *  3. Pressing Enter (without Shift) submits the current input via
 *     `onSend`. Pressing Shift+Enter does NOT submit (newline only).
 *  4. While `isStreaming` is true the send button is replaced with a
 *     stop button that fires `onStop` instead.
 */

import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./PublicComposeInput.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { PublicComposeInput } from "./PublicComposeInput";

interface HarnessProps {
  initialInput?: string;
  onSend?: (content: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
}

function Harness({
  initialInput = "",
  onSend = () => {},
  onStop = () => {},
  isStreaming = false,
}: HarnessProps) {
  const [input, setInput] = useState(initialInput);
  return (
    <PublicComposeInput
      input={input}
      onInputChange={setInput}
      onSend={onSend}
      onStop={onStop}
      isStreaming={isStreaming}
    />
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PublicComposeInput", () => {
  it("renders the public-mode placeholder copy", () => {
    render(<Harness />);
    const textarea = screen.getByLabelText("Compose") as HTMLTextAreaElement;
    expect(textarea.placeholder).toMatch(/ask anything privately/i);
  });

  it("fires onInputChange as the user types", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByLabelText("Compose") as HTMLTextAreaElement;
    await user.type(textarea, "hello");
    expect(textarea.value).toBe("hello");
  });

  it("submits on Enter (without Shift) via onSend", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const textarea = screen.getByLabelText("Compose") as HTMLTextAreaElement;
    await user.type(textarea, "hi there");
    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hi there");
  });

  it("does NOT submit on Shift+Enter (newline only)", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const textarea = screen.getByLabelText("Compose") as HTMLTextAreaElement;
    await user.type(textarea, "draft");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables Send while the input is empty", () => {
    render(<Harness />);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
  });

  it("clicking Send fires onSend with the current input", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Harness initialInput="ready" onSend={onSend} />);
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("ready");
  });

  it("renders Stop instead of Send while streaming and fires onStop", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(
      <Harness
        initialInput="anything"
        onSend={onSend}
        onStop={onStop}
        isStreaming
      />,
    );
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });
});
