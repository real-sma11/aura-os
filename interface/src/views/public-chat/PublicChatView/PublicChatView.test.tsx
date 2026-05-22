/**
 * Behavioural test for `PublicChatView`'s landing layout.
 *
 * The public surface no longer renders a chat input, transcript, or
 * gate modal — it is a pure marketing landing with the decorative
 * `MockAuraApp` hero and a single bottom-anchored "Create your agent"
 * CTA button. These tests pin that contract and guard against any of
 * the removed chat chrome accidentally reappearing.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../MockAuraApp", () => ({
  MockAuraApp: () => <div data-testid="mock-aura-app-stub" />,
}));

import { PublicChatView } from "./PublicChatView";

function renderView() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <PublicChatView />
    </MemoryRouter>,
  );
}

describe("PublicChatView landing", () => {
  it("renders the MockAuraApp hero inside the empty-state region", () => {
    renderView();
    expect(screen.getByTestId("mock-aura-app-stub")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Start a new conversation" }),
    ).toBeInTheDocument();
  });

  it("renders the single 'Create your agent' CTA button", () => {
    renderView();
    const buttons = screen.getAllByRole("button", { name: /create your agent/i });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute(
      "data-agent-surface",
      "public-landing-cta",
    );
  });

  it("does not render any chat input, transcript, or gate modal", () => {
    renderView();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Compose")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("keep-chatting-modal-stub"),
    ).not.toBeInTheDocument();
  });

  it("renders the 6 persona ticks on the right rail", () => {
    renderView();
    const personas = [
      "Vibecoder",
      "Indie Hacker",
      "Giga Brain",
      "Coordinator",
      "Researcher",
      "Cypher Punk",
    ];
    for (const name of personas) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByTestId("persona-tick-rail")).toBeInTheDocument();
  });

  it("marks the first persona tick active by default and shifts active on hover", () => {
    renderView();
    const vibecoder = screen.getByRole("button", { name: "Vibecoder" });
    const researcher = screen.getByRole("button", { name: "Researcher" });

    // First tick paints active on mount, every other tick paints idle.
    expect(vibecoder).toHaveAttribute("aria-current", "true");
    expect(vibecoder).toHaveAttribute("data-active", "true");
    expect(researcher).not.toHaveAttribute("aria-current");
    expect(researcher).toHaveAttribute("data-active", "false");

    // Hovering a different tick promotes it to active and demotes the
    // previously-active row — the panel renders this same flag.
    fireEvent.mouseEnter(researcher);
    expect(researcher).toHaveAttribute("aria-current", "true");
    expect(researcher).toHaveAttribute("data-active", "true");
    expect(vibecoder).not.toHaveAttribute("aria-current");
    expect(vibecoder).toHaveAttribute("data-active", "false");
  });
});
