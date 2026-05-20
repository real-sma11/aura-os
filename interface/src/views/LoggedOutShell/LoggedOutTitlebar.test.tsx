/**
 * Smoke test for the `LoggedOutTitlebar` shell chrome. Verifies the
 * intentional affordances ship together:
 *
 *  - The AURA wordmark renders in the leading (left) `icon` slot.
 *  - The trailing (right) `actions` slot hosts the Log in / Sign up
 *    CTA pills alongside the native `WindowControls` strip so the
 *    anonymous shell keeps parity with the authenticated chrome.
 *  - The `title` slot is empty — there is no centered wordmark.
 *  - Both auth pills route into the canonical `/login` paths
 *    (`/login` and `/login?tab=register`) so the marketing/auth flow
 *    stays consistent across the logged-out shell and `LoginView`.
 *
 * Heavy zui chrome (`Topbar`, `ButtonWindow`) is replaced with thin
 * pass-throughs so the test does not pull in the full
 * `@cypher-asi/zui` runtime — that keeps this a real "render without
 * crashing" smoke test rather than a transitive integration test for
 * the design system. `useAuraCapabilities` is stubbed to enable the
 * native window-controls branch so we can assert the trio is wired up
 * end-to-end in the trailing slot.
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
  Button: ({ children, ...props }: { children?: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  ButtonWindow: ({ action }: { action: string }) => (
    <button aria-label={`window-${action}`} data-window-action={action} />
  ),
}));

vi.mock("../../lib/windowCommand", () => ({
  windowCommand: vi.fn(),
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({
    features: { windowControls: true },
  }),
}));

import { LoggedOutTitlebar } from "./LoggedOutTitlebar";

function renderTitlebar(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LoggedOutTitlebar />
    </MemoryRouter>,
  );
}

describe("LoggedOutTitlebar", () => {
  it("renders the AURA logo in the leading icon slot and leaves the title slot empty", () => {
    renderTitlebar();
    expect(screen.getByTestId("zui-topbar-stub")).toBeInTheDocument();
    const icon = screen.getByTestId("topbar-icon");
    expect(within(icon).getByAltText("AURA")).toBeInTheDocument();
    expect(screen.getByTestId("topbar-title")).toBeEmptyDOMElement();
  });

  it("hosts the Log in / Sign up pills and window controls in the trailing actions slot", () => {
    renderTitlebar();
    const actions = screen.getByTestId("topbar-actions");
    const loginLink = within(actions).getByRole("link", { name: "Log in" });
    const registerLink = within(actions).getByRole("link", { name: "Sign up for free" });
    expect(loginLink).toHaveAttribute("href", "/login");
    expect(registerLink).toHaveAttribute("href", "/login?tab=register");
    expect(within(actions).getByLabelText("window-minimize")).toBeInTheDocument();
    expect(within(actions).getByLabelText("window-maximize")).toBeInTheDocument();
    expect(within(actions).getByLabelText("window-close")).toBeInTheDocument();
  });

  it("preserves the active ?session= query when routing to the login modal", () => {
    // Regression for the "every Log in click mints a new empty chat"
    // bug. Stripping the session id on the way into `/login` caused
    // `LoggedOutChatView` (which renders behind the login overlay
    // too) to re-enter its auto-create branch and append a stray
    // session to the sidebar. Both pills must carry the current
    // session id forward; Sign up additionally appends `tab=register`
    // so the form opens on the Create Account tab.
    renderTitlebar("/?session=public-abc");
    const actions = screen.getByTestId("topbar-actions");
    const loginLink = within(actions).getByRole("link", { name: "Log in" });
    const registerLink = within(actions).getByRole("link", { name: "Sign up for free" });
    expect(loginLink).toHaveAttribute("href", "/login?session=public-abc");
    expect(registerLink).toHaveAttribute(
      "href",
      "/login?session=public-abc&tab=register",
    );
  });
});
