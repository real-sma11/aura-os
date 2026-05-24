/**
 * Phase 4 vitest for `KeepChattingModal`. The modal is the
 * non-dismissable upgrade gate the public-mode shell mounts once
 * `turnCount >= 3`. The contract this file pins:
 *
 * - Renders heading + body copy + both CTA links.
 * - `role="dialog"`, `aria-modal="true"`, and `aria-labelledby`
 *   match the heading id (rules-react-components > A11Y).
 * - Initial focus is the primary "Log in" link.
 * - The CTA `href`s point at `/login` and `/login?tab=register`.
 * - Esc and overlay click do NOT unmount or fire any callback —
 *   the modal stays mounted (the only exits are the CTAs).
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { KeepChattingModal } from "./KeepChattingModal";

function renderModal() {
  return render(
    <MemoryRouter>
      <KeepChattingModal />
    </MemoryRouter>,
  );
}

describe("KeepChattingModal", () => {
  it("renders the heading and body copy", () => {
    renderModal();
    expect(screen.getByText("Thanks for trying AURA")).toBeInTheDocument();
    expect(
      screen.getByText("Log in or sign up to keep chatting"),
    ).toBeInTheDocument();
  });

  it("renders both CTAs", () => {
    renderModal();
    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Sign up for free" }),
    ).toBeInTheDocument();
  });

  it("marks the panel as a modal dialog labelled by the heading", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const heading = document.getElementById(labelledBy ?? "");
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("Thanks for trying AURA");
  });

  it("auto-focuses the primary Log in CTA on mount", async () => {
    renderModal();
    const primary = await screen.findByRole("link", { name: "Log in" });
    expect(primary).toHaveFocus();
  });

  it("primary CTA navigates to /login", () => {
    renderModal();
    const primary = screen.getByRole("link", { name: "Log in" });
    expect(primary.getAttribute("href")).toBe("/login");
  });

  it("secondary CTA navigates to /login?tab=register", () => {
    renderModal();
    const secondary = screen.getByRole("link", { name: "Sign up for free" });
    expect(secondary.getAttribute("href")).toBe("/login?tab=register");
  });

  it("Esc does not dismiss the modal (no unmount)", async () => {
    renderModal();
    const user = userEvent.setup();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Overlay click does not dismiss the modal", async () => {
    const { container } = renderModal();
    const user = userEvent.setup();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const overlay = container.firstElementChild;
    expect(overlay).not.toBeNull();
    if (overlay) {
      await user.click(overlay as Element);
    }
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not render a close button", () => {
    renderModal();
    const closeButton = screen.queryByRole("button", { name: /close/i });
    expect(closeButton).toBeNull();
  });
});
