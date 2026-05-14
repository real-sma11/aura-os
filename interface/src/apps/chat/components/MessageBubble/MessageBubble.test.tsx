import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageBubble } from "./MessageBubble";
import { useUIModalStore } from "../../../../stores/ui-modal-store";

vi.mock("lucide-react", () => ({
  FileText: () => null,
}));

vi.mock("../../../../shared/hooks/use-highlighted-html", () => ({
  useHighlightedHtml: () => "",
}));

vi.mock("../../../../components/ResponseBlock", () => ({
  ResponseBlock: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../LLMOutput", () => ({
  LLMOutput: ({ content }: { content: string }) => <div data-testid="llm-output">{content}</div>,
}));

vi.mock("./LargeTextBlock", () => ({
  LargeTextBlock: ({ text }: { text: string }) => <div>{text}</div>,
  isLargeText: () => false,
}));

vi.mock("../../../../components/CopyButton", () => ({
  CopyButton: ({ ariaLabel }: { ariaLabel: string }) => (
    <button type="button" aria-label={ariaLabel}>copy</button>
  ),
}));

vi.mock("../../../../components/ReportBugButton", () => ({
  ReportBugButton: () => (
    <button type="button" aria-label="Report bug">Report bug</button>
  ),
}));

vi.mock("./MessageBubble.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

describe("MessageBubble", () => {
  afterEach(() => {
    useUIModalStore.setState({ buyCreditsOpen: false });
  });

  it("renders the error message inline with the Buy credits button for insufficient credits errors", () => {
    render(
      <MessageBubble
        message={{
          id: "error-1",
          role: "assistant",
          content: "",
          errorMessage: "You have no credits remaining. Buy more credits to continue.",
          displayVariant: "insufficientCreditsError",
        }}
      />,
    );

    // The error string is now rendered inside the action row,
    // truncated to a single line, with the full text exposed
    // through the `title` attribute for hover.
    const messageSpan = screen.getByTitle(
      "You have no credits remaining. Buy more credits to continue.",
    );
    expect(messageSpan).toBeInTheDocument();
    expect(messageSpan).toHaveTextContent(
      "You have no credits remaining. Buy more credits to continue.",
    );

    // Buy credits is now sibling to the message span (same row),
    // not stacked above it.
    fireEvent.click(screen.getByRole("button", { name: "Buy credits" }));
    expect(useUIModalStore.getState().buyCreditsOpen).toBe(true);

    // No top-of-bubble LLMOutput is rendered when there is no
    // streaming prefix to show -- avoids the duplicate-text shape
    // the chat used to fall back to.
    expect(screen.queryByTestId("llm-output")).not.toBeInTheDocument();
  });

  it("renders the error message + Support ID chip + Report Bug on a single row for unbucketed errors", () => {
    render(
      <MessageBubble
        message={{
          id: "error-2",
          role: "assistant",
          content: "",
          errorMessage: "Model call timed out after 180s",
          supportId: "abc123def456",
        }}
      />,
    );

    const messageSpan = screen.getByTitle("Model call timed out after 180s");
    expect(messageSpan).toBeInTheDocument();
    // Support ID label + value are rendered alongside.
    expect(screen.getByText("Support ID")).toBeInTheDocument();
    expect(screen.getByText("abc123def456")).toBeInTheDocument();
    // Report bug button is wired up.
    expect(screen.getByRole("button", { name: "Report bug" })).toBeInTheDocument();
    // Buy credits should NOT appear for this variant.
    expect(screen.queryByRole("button", { name: "Buy credits" })).not.toBeInTheDocument();
  });

  it("preserves the partial streaming prefix in LLMOutput while routing the error to the action row", () => {
    render(
      <MessageBubble
        message={{
          id: "error-3",
          role: "assistant",
          content: "Here is the start of my answer",
          errorMessage: "connection lost",
          supportId: "deadbeefcafe",
        }}
      />,
    );

    // The pre-error prefix renders verbatim through LLMOutput,
    // unchanged by error chrome.
    expect(screen.getByTestId("llm-output")).toHaveTextContent(
      "Here is the start of my answer",
    );
    // The error string lives in the action row, not inside the
    // prefix.
    expect(screen.getByTitle("connection lost")).toBeInTheDocument();
    expect(screen.queryByTestId("llm-output")).not.toHaveTextContent(
      "connection lost",
    );
  });

  it("does not render the error action row on successful turns", () => {
    render(
      <MessageBubble
        message={{
          id: "ok-1",
          role: "assistant",
          content: "All done.",
        }}
      />,
    );

    // The chat shows the assistant content normally.
    expect(screen.getByTestId("llm-output")).toHaveTextContent("All done.");
    // No support id chip, no report bug, no buy credits, no
    // truncated error span -- the action row is gated entirely
    // on error chrome being present.
    expect(screen.queryByText("Support ID")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Report bug" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buy credits" })).not.toBeInTheDocument();
  });

  it("renders normal assistant content unchanged when no error chrome is present", () => {
    render(
      <MessageBubble
        message={{
          id: "message-1",
          role: "assistant",
          content: "*Error: something broke*",
        }}
      />,
    );

    // The pre-existing fallback shape (model-emitted markdown that
    // happens to look like an error) is still rendered through
    // LLMOutput verbatim because no `errorMessage`/`displayVariant`
    // is set on the event itself.
    expect(screen.getByTestId("llm-output")).toHaveTextContent("*Error: something broke*");
    expect(screen.queryByRole("button", { name: "Buy credits" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Report bug" })).not.toBeInTheDocument();
  });
});
