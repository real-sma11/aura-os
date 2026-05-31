/**
 * Vitest for `BugReportConsentModal`, focused on the submit UX:
 *
 * - Send is gated on consent + a non-empty description.
 * - On a successful `bugReportsApi.create`, the modal shows an inline
 *   "Report sent" confirmation (the user feedback that was previously
 *   missing) instead of silently closing.
 * - On a failed create, the inline error is shown and the form stays open.
 *
 * The api/diagnostics/analytics dependencies are mocked so the test
 * exercises only the component's own state machine.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const bugReportsApiMock = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("../../api/bug-reports", () => ({
  bugReportsApi: bugReportsApiMock,
}));

vi.mock("../../shared/observability/collect-bug-diagnostics", () => ({
  collectBugDiagnostics: () => ({ collected: true }),
}));

vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));

vi.mock("./BugReportConsentModal.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ isMobileLayout: false }),
}));

vi.mock("../../hooks/use-modal-initial-focus", () => ({
  useModalInitialFocus: () => ({
    inputRef: { current: null },
    initialFocusRef: undefined,
  }),
}));

vi.mock("../Select", () => ({
  Select: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <select
      aria-label="Severity"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high">High</option>
      <option value="critical">Critical</option>
    </select>
  ),
}));

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
    footer: React.ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        <div>{children}</div>
        <div data-testid="modal-footer">{footer}</div>
      </div>
    ) : null,
  Button: ({
    children,
    disabled,
    onClick,
    "aria-label": ariaLabel,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    "aria-label"?: string;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  ),
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { BugReportConsentModal } from "./BugReportConsentModal";

function fillAndConsent() {
  fireEvent.change(screen.getByLabelText("Bug description"), {
    target: { value: "It crashed when I clicked send" },
  });
  fireEvent.click(
    screen.getByLabelText("Consent to share prompt and conversation data"),
  );
}

describe("BugReportConsentModal", () => {
  beforeEach(() => {
    bugReportsApiMock.create.mockReset();
  });

  it("keeps Send disabled until consent and a description are provided", () => {
    render(
      <BugReportConsentModal isOpen onClose={() => {}} diagnosticsInput={{}} />,
    );
    const send = screen.getByRole("button", { name: "Send bug report" });
    expect(send).toBeDisabled();

    fillAndConsent();
    expect(send).not.toBeDisabled();
  });

  it("shows a success confirmation after a successful send", async () => {
    bugReportsApiMock.create.mockResolvedValueOnce({
      id: "report-1",
      feedbackPostId: "post-1",
    });
    const onClose = vi.fn();

    render(
      <BugReportConsentModal isOpen onClose={onClose} diagnosticsInput={{}} />,
    );
    fillAndConsent();
    fireEvent.click(screen.getByRole("button", { name: "Send bug report" }));

    await screen.findByText("Report sent");
    expect(screen.getByText(/added to the Feedback section/i)).toBeInTheDocument();
    expect(bugReportsApiMock.create).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("surfaces an error and stays open when the send fails", async () => {
    bugReportsApiMock.create.mockRejectedValueOnce(
      new Error("The request timed out. Please try again."),
    );

    render(
      <BugReportConsentModal isOpen onClose={() => {}} diagnosticsInput={{}} />,
    );
    fillAndConsent();
    fireEvent.click(screen.getByRole("button", { name: "Send bug report" }));

    await screen.findByText("The request timed out. Please try again.");
    expect(screen.queryByText("Report sent")).not.toBeInTheDocument();
  });
});
