/**
 * Smoke test for `LoggedOutShell` — the top-level layout shell of
 * the anonymous web experience. Confirms the three regions of the
 * shell mount together (titlebar, sessions sidebar, main outlet)
 * without throwing, with the heavier zui chrome and theme/wallpaper
 * machinery stubbed so the test stays focused on the component's
 * own composition contract instead of transitive setup.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
      <div>{icon}</div>
      <div>{title}</div>
      <div>{actions}</div>
    </div>
  ),
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

vi.mock("../../lib/windowCommand", () => ({
  windowCommand: vi.fn(),
}));

vi.mock("../../components/DesktopShell/BackgroundLayer", () => ({
  BackgroundLayer: () => <div data-testid="background-layer-stub" />,
}));

import { LoggedOutShell } from "./LoggedOutShell";

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<LoggedOutShell />}>
          <Route
            path="/"
            element={<div data-testid="outlet-child">child route</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("LoggedOutShell", () => {
  it("mounts the titlebar, sidebar, and outlet without crashing", () => {
    renderShell();
    // Titlebar rendered (via the zui Topbar stub).
    expect(screen.getByTestId("zui-topbar-stub")).toBeInTheDocument();
    // Background layer rendered (stubbed away from theme + wallpaper).
    expect(screen.getByTestId("background-layer-stub")).toBeInTheDocument();
    // Sessions sidebar header — proves the sidebar mounted.
    expect(screen.getByText("Chats")).toBeInTheDocument();
    // The "+" button on the sidebar is reachable (a11y-labelled).
    expect(
      screen.getByRole("button", { name: "New chat" }),
    ).toBeInTheDocument();
    // The outlet child rendered into the main panel.
    expect(screen.getByTestId("outlet-child")).toBeInTheDocument();
  });

  it("surfaces the marketing footer + upsell card on first paint", () => {
    renderShell();
    expect(screen.getByText("Get responses tailored to you")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Product" }),
    ).toHaveAttribute("href", "https://aura.ai/product");
  });
});
