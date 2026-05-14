/**
 * Phase 5 vitest for the `ReportBugButton`. Covers the three
 * behaviours the chat-side wiring depends on:
 *
 * - The button renders a clickable affordance whose copy
 *   identifies it as a bug-report path.
 * - Clicking it opens the underlying `NewFeedbackModal` with a
 *   pre-filled title (carrying the support id) and a body that
 *   includes the recent breadcrumbs for the supplied stream key.
 * - The pre-fill bundle pulls breadcrumbs from the global ring
 *   filtered to the requested `streamKey`.
 *
 * The `NewFeedbackModal` import is mocked to a thin spy so we
 * can assert the prefill prop directly without dragging the
 * full feedback-store boot path into the test.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const newFeedbackModalSpy = vi.fn();

vi.mock("../../apps/feedback/NewFeedbackModal", () => ({
  NewFeedbackModal: (props: {
    isOpen: boolean;
    onClose: () => void;
    prefill?: { title?: string; body?: string; category?: string; product?: string };
  }) => {
    newFeedbackModalSpy(props);
    if (!props.isOpen) return null;
    return (
      <div data-testid="mock-feedback-modal">
        <span data-testid="modal-title">{props.prefill?.title ?? ""}</span>
        <pre data-testid="modal-body">{props.prefill?.body ?? ""}</pre>
        <span data-testid="modal-category">{props.prefill?.category ?? ""}</span>
        <span data-testid="modal-product">{props.prefill?.product ?? ""}</span>
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

vi.mock("../../lib/build-info", () => ({
  getBuildInfo: () => ({
    version: "9.9.9-test",
    commit: "deadbee",
    buildTime: "dev",
    channel: "dev",
    isDev: true,
  }),
}));

import { ReportBugButton } from "./ReportBugButton";
import {
  appendBreadcrumb,
  clear as clearBreadcrumbs,
} from "../../stores/stream-breadcrumbs-store";

describe("ReportBugButton", () => {
  beforeEach(() => {
    newFeedbackModalSpy.mockClear();
    clearBreadcrumbs();
  });

  it("renders a 'Report bug' button", () => {
    render(<ReportBugButton streamKey="agent:abc" />);
    const btn = screen.getByRole("button", { name: "Report bug" });
    expect(btn).toBeInTheDocument();
  });

  it("opens the modal pre-filled with title, category, product, and the breadcrumb-derived body", () => {
    appendBreadcrumb({
      ts: 1_700_000_000_000,
      classified: "failed",
      message: "first failure",
      streamKey: "agent:abc",
      support_id: "111111111111",
    });
    appendBreadcrumb({
      ts: 1_700_000_000_500,
      classified: "completed",
      message: "second event on different stream",
      streamKey: "agent:zzz",
    });
    appendBreadcrumb({
      ts: 1_700_000_001_000,
      classified: "streamDropped",
      message: "ws closed",
      code: "harness_ws_closed",
      streamKey: "agent:abc",
      support_id: "222222222222",
    });

    render(
      <ReportBugButton
        streamKey="agent:abc"
        supportId="222222222222"
        agentId="agent-7"
        sessionId="session-42"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Report bug" }));

    expect(screen.getByTestId("mock-feedback-modal")).toBeInTheDocument();
    expect(screen.getByTestId("modal-title").textContent).toBe(
      "Agent issue (support_id=222222222222)",
    );
    expect(screen.getByTestId("modal-category").textContent).toBe("bug");
    expect(screen.getByTestId("modal-product").textContent).toBe("aura");

    const body = screen.getByTestId("modal-body").textContent ?? "";
    expect(body).toContain("Build: 9.9.9-test");
    expect(body).toContain("Stream key: agent:abc");
    expect(body).toContain("Agent: agent-7");
    expect(body).toContain("Session: session-42");
    expect(body).toContain("Support IDs (last 3): 111111111111, 222222222222");
    // Both breadcrumbs for `agent:abc` should land in the body;
    // the unrelated `agent:zzz` entry should be filtered out.
    expect(body).toContain("first failure");
    expect(body).toContain("ws closed");
    expect(body).not.toContain("second event on different stream");
  });

  it("falls back to 'n/a' for missing context fields and renders an empty breadcrumb block", () => {
    render(<ReportBugButton streamKey="agent:lonely" />);
    fireEvent.click(screen.getByRole("button", { name: "Report bug" }));

    const body = screen.getByTestId("modal-body").textContent ?? "";
    expect(body).toContain("Stream key: agent:lonely");
    expect(body).toContain("Agent: n/a");
    expect(body).toContain("Session: n/a");
    expect(body).toContain("Support IDs (last 3): n/a");
    expect(body).toContain("(no recent breadcrumbs captured)");
  });

  it("appends an optional title suffix when provided (used by the StuckStreamPill)", () => {
    render(
      <ReportBugButton
        streamKey="agent:abc"
        supportId="cafebabec0de"
        titleSuffix="stuck stream"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Report bug" }));
    expect(screen.getByTestId("modal-title").textContent).toBe(
      "Agent issue (support_id=cafebabec0de) — stuck stream",
    );
  });

  it("closes the modal when the modal's onClose fires", () => {
    render(<ReportBugButton streamKey="agent:abc" />);
    fireEvent.click(screen.getByRole("button", { name: "Report bug" }));
    expect(screen.queryByTestId("mock-feedback-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByText("close-modal"));
    expect(screen.queryByTestId("mock-feedback-modal")).not.toBeInTheDocument();
  });
});
