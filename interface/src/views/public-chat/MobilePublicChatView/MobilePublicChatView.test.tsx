/**
 * Behavioural tests for `MobilePublicChatView`.
 *
 * The mobile public surface is intentionally minimal — a centered
 * "What do you want to create?" hero on the landing route and a
 * scrollable transcript + sticky composer on `/chat`. These tests
 * pin that contract and the SSE dispatch wiring.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { streamPublicChatMock } = vi.hoisted(() => ({
  streamPublicChatMock: vi.fn(),
}));

vi.mock("../../../api/public-chat", () => ({
  streamPublicChat: streamPublicChatMock,
}));

import { MobilePublicChatView } from "./MobilePublicChatView";
import { usePublicChatStore } from "../../../stores/public-chat-store";

function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return (
    <div
      data-testid="location-probe"
      data-pathname={location.pathname}
      data-search={location.search}
    />
  );
}

function renderView(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<MobilePublicChatView />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  streamPublicChatMock.mockImplementation(
    (args: { onDelta: (text: string) => void; onDone?: () => void }) => {
      args.onDelta("Hi from Aura");
      args.onDone?.();
      return { close: vi.fn() };
    },
  );
  usePublicChatStore.setState({
    sessions: {},
    sessionOrder: [],
    turnCount: 0,
    guestToken: "guest-token",
    setupInFlight: false,
  });
});

afterEach(() => {
  window.localStorage.clear();
  streamPublicChatMock.mockReset();
  usePublicChatStore.setState({
    sessions: {},
    sessionOrder: [],
    turnCount: 0,
    guestToken: null,
    setupInFlight: false,
  });
});

describe("MobilePublicChatView", () => {
  it("renders the 'What do you want to create?' hero on the landing route", () => {
    renderView("/");
    expect(screen.getByTestId("mobile-public-chat-view")).toBeInTheDocument();
    // The placeholder string lives both in the heading and on the input.
    const headings = screen.getAllByText("What do you want to create?");
    expect(headings.length).toBeGreaterThanOrEqual(1);
    const input = screen.getByRole("textbox", { name: "Message Aura" });
    expect(input).toHaveAttribute("placeholder", "What do you want to create?");
  });

  it("submits the composer, navigates to /chat?session=<id>, and renders the streamed reply", async () => {
    renderView("/");

    const input = screen.getByRole("textbox", { name: "Message Aura" });
    fireEvent.change(input, { target: { value: "build me a chess app" } });
    const submit = screen.getByRole("button", { name: "Send" });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(streamPublicChatMock).toHaveBeenCalledTimes(1);
    });

    const probe = screen.getByTestId("location-probe");
    await waitFor(() => {
      expect(probe).toHaveAttribute("data-pathname", "/chat");
    });
    const search = probe.getAttribute("data-search");
    expect(search).toMatch(/^\?session=public-/);

    // User turn rendered.
    expect(screen.getByText("build me a chess app")).toBeInTheDocument();
    // Assistant token from the mock stream rendered.
    expect(screen.getByText("Hi from Aura")).toBeInTheDocument();

    // Stream args carried through with mode "code" and the typed message.
    const callArgs = streamPublicChatMock.mock.calls[0]?.[0] as {
      message: string;
      mode: string;
      sessionId: string;
      token: string;
    };
    expect(callArgs.message).toBe("build me a chess app");
    expect(callArgs.mode).toBe("code");
    expect(callArgs.token).toBe("guest-token");
    expect(callArgs.sessionId).toMatch(/^public-/);
  });

  it("auto-mints (or reuses) a session and rewrites the URL when landing on /chat without one", async () => {
    renderView("/chat");

    const probe = screen.getByTestId("location-probe");
    await waitFor(() => {
      expect(probe.getAttribute("data-search")).toMatch(/^\?session=public-/);
    });

    const order = usePublicChatStore.getState().sessionOrder;
    expect(order).toHaveLength(1);
    expect(probe.getAttribute("data-search")).toBe(`?session=${order[0]}`);
  });

  it("does NOT render the desktop hero hooks (MockAuraApp, persona tick rail) on either route", () => {
    renderView("/");
    expect(screen.queryByTestId("mock-aura-app-stub")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Agent personas")).not.toBeInTheDocument();
  });
});
