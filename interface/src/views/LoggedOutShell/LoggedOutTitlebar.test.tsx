/**
 * Smoke test for the `LoggedOutTitlebar` shell chrome. Verifies the
 * intentional affordances ship together:
 *
 *  - The AURA wordmark renders in the trailing (right) `actions` slot.
 *  - The leading (left) slot hosts the Log in / Sign up CTA pills.
 *  - The `title` slot is empty — there is no centered wordmark.
 *  - Both auth pills route into the canonical `/login` paths
 *    (`/login` and `/login?tab=register`) so the marketing/auth flow
 *    stays consistent across the logged-out shell and `LoginView`.
 *
 * Heavy zui chrome (`Topbar`) is replaced with a thin pass-through so
 * the test does not pull in the full `@cypher-asi/zui` runtime — that
 * keeps this a real "render without crashing" smoke test rather than
 * a transitive integration test for the design system.
 */

import { render, screen, within } from "@testing-library/react";
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
  it("renders the AURA logo in the right-hand actions slot and leaves the title slot empty", () => {
    renderTitlebar();
    expect(screen.getByTestId("zui-topbar-stub")).toBeInTheDocument();
    const actions = screen.getByTestId("topbar-actions");
    expect(within(actions).getByAltText("AURA")).toBeInTheDocument();
    expect(screen.getByTestId("topbar-title")).toBeEmptyDOMElement();
  });

  it("hosts the Log in / Sign up pills in the leading icon slot", () => {
    renderTitlebar();
    const icon = screen.getByTestId("topbar-icon");
    const loginLink = within(icon).getByRole("link", { name: "Log in" });
    const registerLink = within(icon).getByRole("link", { name: "Sign up for free" });
    expect(loginLink).toHaveAttribute("href", "/login");
    expect(registerLink).toHaveAttribute("href", "/login?tab=register");
  });
});
