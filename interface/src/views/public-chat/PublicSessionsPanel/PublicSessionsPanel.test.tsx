/**
 * Behavioural test for `PublicSessionsPanel` focused on the
 * delete-chat affordance. The previous implementation nested an
 * interactive delete element inside a row `<button>` and, when the
 * deleted row was the active session, navigated to bare `/chat` — which
 * caused `PublicChatView` to immediately auto-create a fresh "New
 * chat" entry, making the X look like it did nothing. These tests
 * pin both the markup invariant (no nested interactive content)
 * and the navigation contract (hop to the next remaining session
 * instead of bare `/chat` when the active row is deleted).
 */

import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PublicSessionsPanel } from "./PublicSessionsPanel";
import { usePublicChatStore } from "../../../stores/public-chat-store";

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  );
}

function renderPanel(initialPath = "/chat", searchQuery = "") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <Routes>
        <Route
          path="*"
          element={<PublicSessionsPanel searchQuery={searchQuery} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  usePublicChatStore.setState({
    sessions: {},
    sessionOrder: [],
    turnCount: 0,
    guestToken: null,
  });
});

afterEach(() => {
  window.localStorage.clear();
});

describe("PublicSessionsPanel", () => {
  it("removes the row from the list when the X is clicked", async () => {
    const user = userEvent.setup();
    let createdId = "";
    act(() => {
      createdId = usePublicChatStore.getState().createSession();
      usePublicChatStore
        .getState()
        .appendUserTurn(createdId, "hello world");
    });

    renderPanel(`/chat?session=${createdId}`);

    const deleteBtn = await screen.findByRole("button", {
      name: /Delete chat "hello world"/,
    });
    await user.click(deleteBtn);

    expect(usePublicChatStore.getState().sessions[createdId]).toBeUndefined();
    expect(
      screen.queryByRole("button", { name: /Delete chat "hello world"/ }),
    ).not.toBeInTheDocument();
  });

  it("hops to the next remaining session when the active row is deleted (no auto-create)", async () => {
    const user = userEvent.setup();
    let firstId = "";
    let secondId = "";
    act(() => {
      firstId = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(firstId, "first chat");
      secondId = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(secondId, "second chat");
    });

    renderPanel(`/chat?session=${secondId}`);

    const deleteBtn = await screen.findByRole("button", {
      name: /Delete chat "second chat"/,
    });
    await user.click(deleteBtn);

    expect(usePublicChatStore.getState().sessions[secondId]).toBeUndefined();
    expect(
      Object.keys(usePublicChatStore.getState().sessions),
    ).toEqual([firstId]);
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/chat?session=${firstId}`,
    );
  });

  it("falls back to `/chat` when the deleted row was the only session", async () => {
    const user = userEvent.setup();
    let onlyId = "";
    act(() => {
      onlyId = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(onlyId, "lonely chat");
    });

    renderPanel(`/chat?session=${onlyId}`);

    const deleteBtn = await screen.findByRole("button", {
      name: /Delete chat "lonely chat"/,
    });
    await user.click(deleteBtn);

    expect(usePublicChatStore.getState().sessions[onlyId]).toBeUndefined();
    expect(usePublicChatStore.getState().sessionOrder).toEqual([]);
    expect(screen.getByTestId("location")).toHaveTextContent("/chat");
  });

  it("deletes a brand-new empty 'New chat' as the only session and leaves the store empty (no auto-replacement)", async () => {
    // The reported bug: click `+`, land on the freshly-minted "New
    // chat", click the X, watch the chat "come back" because the
    // route-side auto-mint effect spawned a replacement. This test
    // pins the post-fix contract: the delete leaves `sessionOrder`
    // empty AND the URL on bare `/chat`. The matching no-auto-mint
    // assertion on the `/chat` route itself lives in
    // `PublicChatView.test.tsx` — this panel test owns the store +
    // navigation contract on the delete side.
    const user = userEvent.setup();
    let newChatId = "";
    act(() => {
      // No `appendUserTurn` — this is a zero-turn session whose
      // title stays "New chat" (matches the `+` button flow in
      // `AuraSidebar.handleNewChat`).
      newChatId = usePublicChatStore.getState().createSession();
    });

    renderPanel(`/chat?session=${newChatId}`);

    const deleteBtn = await screen.findByRole("button", {
      name: /Delete chat "New chat"/,
    });
    await user.click(deleteBtn);

    expect(usePublicChatStore.getState().sessions[newChatId]).toBeUndefined();
    expect(usePublicChatStore.getState().sessionOrder).toEqual([]);
    expect(screen.getByTestId("location")).toHaveTextContent("/chat");
  });

  it("does not navigate when a non-active row is deleted", async () => {
    const user = userEvent.setup();
    let activeId = "";
    let otherId = "";
    act(() => {
      otherId = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(otherId, "other chat");
      activeId = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(activeId, "active chat");
    });

    renderPanel(`/chat?session=${activeId}`);

    const deleteBtn = await screen.findByRole("button", {
      name: /Delete chat "other chat"/,
    });
    await user.click(deleteBtn);

    expect(usePublicChatStore.getState().sessions[otherId]).toBeUndefined();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/chat?session=${activeId}`,
    );
  });

  it("renders the delete control as a real <button>, not nested interactive content", async () => {
    let id = "";
    act(() => {
      id = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(id, "row text");
    });

    renderPanel(`/chat?session=${id}`);

    const deleteBtn = await screen.findByRole("button", {
      name: /Delete chat "row text"/,
    });
    expect(deleteBtn.tagName).toBe("BUTTON");
    expect(deleteBtn.closest("button")).toBe(deleteBtn);
  });

  it("filters the rendered rows by the searchQuery prop (case-insensitive)", () => {
    act(() => {
      const a = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(a, "Trip planning");
      const b = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(b, "Recipe ideas");
      const c = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(c, "trip itinerary");
    });

    renderPanel("/chat", "trip");

    expect(screen.getByText("Trip planning")).toBeInTheDocument();
    expect(screen.getByText("trip itinerary")).toBeInTheDocument();
    expect(screen.queryByText("Recipe ideas")).not.toBeInTheDocument();
  });

  it("shows a 'no matching chats' empty state when the filter excludes every row", () => {
    act(() => {
      const id = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(id, "Recipe ideas");
    });

    renderPanel("/chat", "spaceships");

    expect(screen.getByText("No matching chats")).toBeInTheDocument();
    expect(screen.queryByText("Recipe ideas")).not.toBeInTheDocument();
  });
});
