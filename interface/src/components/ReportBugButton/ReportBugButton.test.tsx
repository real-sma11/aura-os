/**
 * Vitest for the `ReportBugButton`. Covers the wiring the chat-side
 * surfaces depend on after the move to the private, consent-gated
 * bug-report path:
 *
 * - The button renders a clickable affordance whose copy identifies
 *   it as a bug-report path.
 * - Clicking it opens the `BugReportConsentModal` with the
 *   diagnostics context (stream key, support id, agent id, session
 *   id) forwarded from the render site.
 * - The modal closes when its `onClose` fires.
 *
 * The `BugReportConsentModal` import is mocked to a thin spy so we
 * can assert the forwarded props directly without dragging the
 * collector / api / store boot path into the test.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const consentModalSpy = vi.fn();

vi.mock("./BugReportConsentModal", () => ({
  BugReportConsentModal: (props: {
    isOpen: boolean;
    onClose: () => void;
    diagnosticsInput: {
      streamKey?: string;
      supportId?: string;
      agentId?: string;
      sessionId?: string;
    };
  }) => {
    consentModalSpy(props);
    if (!props.isOpen) return null;
    return (
      <div data-testid="mock-consent-modal">
        <span data-testid="modal-stream">{props.diagnosticsInput.streamKey ?? ""}</span>
        <span data-testid="modal-support">{props.diagnosticsInput.supportId ?? ""}</span>
        <span data-testid="modal-agent">{props.diagnosticsInput.agentId ?? ""}</span>
        <span data-testid="modal-session">{props.diagnosticsInput.sessionId ?? ""}</span>
        <button type="button" onClick={props.onClose}>close-modal</button>
      </div>
    );
  },
}));

vi.mock("@cypher-asi/zui", () => ({
  Button: ({
    children,
    onClick,
    "aria-label": ariaLabel,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    "aria-label"?: string;
  }) => (
    <button type="button" onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}));

import { ReportBugButton } from "./ReportBugButton";

describe("ReportBugButton", () => {
  beforeEach(() => {
    consentModalSpy.mockClear();
  });

  it("renders a 'Report bug' button", () => {
    render(<ReportBugButton streamKey="agent:abc" />);
    const btn = screen.getByRole("button", { name: "Report bug" });
    expect(btn).toBeInTheDocument();
  });

  it("opens the consent modal with the diagnostics context forwarded", () => {
    render(
      <ReportBugButton
        streamKey="agent:abc"
        supportId="222222222222"
        agentId="agent-7"
        sessionId="session-42"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Report bug" }));

    expect(screen.getByTestId("mock-consent-modal")).toBeInTheDocument();
    expect(screen.getByTestId("modal-stream").textContent).toBe("agent:abc");
    expect(screen.getByTestId("modal-support").textContent).toBe("222222222222");
    expect(screen.getByTestId("modal-agent").textContent).toBe("agent-7");
    expect(screen.getByTestId("modal-session").textContent).toBe("session-42");
  });

  it("closes the modal when the modal's onClose fires", () => {
    render(<ReportBugButton streamKey="agent:abc" />);
    fireEvent.click(screen.getByRole("button", { name: "Report bug" }));
    expect(screen.queryByTestId("mock-consent-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByText("close-modal"));
    expect(screen.queryByTestId("mock-consent-modal")).not.toBeInTheDocument();
  });
});
