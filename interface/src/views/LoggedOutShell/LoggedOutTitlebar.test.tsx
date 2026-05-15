/**
 * Smoke test for the `LoggedOutTitlebar` shell chrome. Verifies the
 * three intentional affordances ship together:
 *
 *  - The wordmark / logo render (so the user has a visual anchor).
 *  - Both auth pills route into the canonical `/login` paths
 *    (`/login` and `/login?tab=register`) so the marketing/auth flow
 *    stays consistent across the logged-out shell and `LoginView`.
 *
 * Heavy zui chrome (`Topbar`) is replaced with a thin pass-through so
 * the test does not pull in the full `@cypher-asi/zui` runtime — that
 * keeps this a real "render without crashing" smoke test rather than
 * a transitive integration test for the design system.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@cypher-asi/zui", () => ({
  Topbar: ({
    icon,
    title,
    actions,
  }: {
    icon?: React.ReactNode;
    title?: React.ReactNode;
    actions?: React.ReactNode;
  }) => (
    <div data-testid="zui-topbar-stub">
      <div data-testid="topbar-icon">{icon}</div>
      <div data-testid="topbar-title">{title}</div>
      <div data-testid="topbar-actions">{actions}</div>
    </div>
  ),
}));

vi.mock("../../lib/windowCommand", () => ({
  windowCommand: vi.fn(),
}));

import { LoggedOutTitlebar } from "./LoggedOutTitlebar";

function renderTitlebar() {
  return render(
    <MemoryRouter>
      <LoggedOutTitlebar />
    </MemoryRouter>,
  );
}

describe("LoggedOutTitlebar", () => {
  it("renders without crashing and shows the AURA wordmark", () => {
    renderTitlebar();
    expect(screen.getByTestId("zui-topbar-stub")).toBeInTheDocument();
    expect(screen.getByText("AURA")).toBeInTheDocument();
    expect(screen.getByAltText("AURA")).toBeInTheDocument();
  });

  it("ships both auth pills and routes them to the canonical /login paths", () => {
    renderTitlebar();
    const loginLink = screen.getByRole("link", { name: "Log in" });
    const registerLink = screen.getByRole("link", { name: "Sign up for free" });
    expect(loginLink).toHaveAttribute("href", "/login");
    expect(registerLink).toHaveAttribute("href", "/login?tab=register");
  });
});
