import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

// Keep the unit isolated from the heavy `AppNavRail` module graph
// (stores, app registry, etc.) — we only need the presentational
// button shell here.
vi.mock("../AppNavRail", () => ({
  TASKBAR_ICON_SIZE: 16,
  TaskbarIconButton: ({
    icon,
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
    <button {...props}>
      {icon}
      {children}
    </button>
  ),
}));

vi.mock("lucide-react", () => ({
  MessageSquare: () => <svg data-testid="chat-icon" />,
}));

import { PublicChatTaskbarButton } from "./PublicChatTaskbarButton";

function LocationProbe(): React.ReactElement {
  const loc = useLocation();
  return <div data-testid="loc">{`${loc.pathname}${loc.search}`}</div>;
}

function renderAt(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <PublicChatTaskbarButton />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("PublicChatTaskbarButton", () => {
  it("opens /chat from a non-chat page", async () => {
    const user = userEvent.setup();
    renderAt("/agents");

    const button = screen.getByRole("button", { name: "Chat" });
    await user.click(button);

    expect(screen.getByTestId("loc")).toHaveTextContent("/chat");
  });

  it("returns to the previous page when clicked again from /chat", async () => {
    const user = userEvent.setup();
    renderAt("/pricing");

    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByTestId("loc")).toHaveTextContent("/chat");

    // On /chat the control flips to a "back" affordance pointing at
    // the remembered previous location.
    const back = screen.getByRole("button", { name: "Back to previous page" });
    await user.click(back);

    expect(screen.getByTestId("loc")).toHaveTextContent("/pricing");
  });

  it("falls back to / when there is no previous non-chat page", async () => {
    const user = userEvent.setup();
    renderAt("/chat");

    const back = screen.getByRole("button", { name: "Back to previous page" });
    await user.click(back);

    expect(screen.getByTestId("loc")).toHaveTextContent("/");
  });
});
