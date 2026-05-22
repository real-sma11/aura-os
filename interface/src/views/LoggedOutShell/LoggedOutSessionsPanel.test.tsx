/**
 * Behavioural test for `LoggedOutSessionsPanel` focused on the
 * delete-chat affordance. The previous implementation nested an
 * interactive delete element inside a row `<button>` and, when the
 * deleted row was the active session, navigated to `/` — which
 * caused `LoggedOutChatView` to immediately auto-create a fresh
 * "New chat" entry, making the X look like it did nothing. These
 * tests pin both the markup invariant (no nested interactive content)
 * and the navigation contract (hop to the next remaining session
 * instead of `/` when the active row is deleted).
 */

import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LoggedOutSessionsPanel } from "./LoggedOutSessionsPanel";
import { usePublicChatStore } from "../../stores/public-chat-store";

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  );
}

function renderPanel(initialPath = "/", searchQuery = "") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/"
          element={<LoggedOutSessionsPanel searchQuery={searchQuery} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  // Reset the live store between tests; the module is shared across
  // the suite so we have to clear sessions explicitly.
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

describe("LoggedOutSessionsPanel", () => {
  it("removes the row from the list when the X is clicked", async () => {
    const user = userEvent.setup();
    let createdId = "";
    act(() => {
      createdId = usePublicChatStore.getState().createSession();
      usePublicChatStore
        .getState()
        .appendUserTurn(createdId, "hello world");
    });

    renderPanel(`/?session=${createdId}`);

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
      // sessionOrder is newest-first, so create `first` then `second`
      // and delete `second` (the active one); the next active should
      // be `first`.
      firstId = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(firstId, "first chat");
      secondId = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(secondId, "second chat");
    });

    renderPanel(`/?session=${secondId}`);

    const deleteBtn = await screen.findByRole("button", {
      name: /Delete chat "second chat"/,
    });
    await user.click(deleteBtn);

    expect(usePublicChatStore.getState().sessions[secondId]).toBeUndefined();
    // The remaining session is preserved — we did NOT navigate to `/`
    // and trigger an auto-created replacement.
    expect(
      Object.keys(usePublicChatStore.getState().sessions),
    ).toEqual([firstId]);
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/?session=${firstId}`,
    );
  });

  it("falls back to `/` when the deleted row was the only session", async () => {
    const user = userEvent.setup();
    let onlyId = "";
    act(() => {
      onlyId = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(onlyId, "lonely chat");
    });

    renderPanel(`/?session=${onlyId}`);

    const deleteBtn = await screen.findByRole("button", {
      name: /Delete chat "lonely chat"/,
    });
    await user.click(deleteBtn);

    expect(usePublicChatStore.getState().sessions[onlyId]).toBeUndefined();
    expect(usePublicChatStore.getState().sessionOrder).toEqual([]);
    expect(screen.getByTestId("location")).toHaveTextContent("/");
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

    renderPanel(`/?session=${activeId}`);

    const deleteBtn = await screen.findByRole("button", {
      name: /Delete chat "other chat"/,
    });
    await user.click(deleteBtn);

    expect(usePublicChatStore.getState().sessions[otherId]).toBeUndefined();
    // URL is unchanged because the active session was untouched.
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/?session=${activeId}`,
    );
  });

  it("renders the delete control as a real <button>, not nested interactive content", async () => {
    let id = "";
    act(() => {
      id = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(id, "row text");
    });

    renderPanel(`/?session=${id}`);

    const deleteBtn = await screen.findByRole("button", {
      name: /Delete chat "row text"/,
    });
    expect(deleteBtn.tagName).toBe("BUTTON");
    // The delete button must not live inside another <button> — that's
    // invalid HTML and was the source of unreliable click delivery.
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

    renderPanel("/", "trip");

    expect(screen.getByText("Trip planning")).toBeInTheDocument();
    expect(screen.getByText("trip itinerary")).toBeInTheDocument();
    expect(screen.queryByText("Recipe ideas")).not.toBeInTheDocument();
  });

  it("shows a 'no matching chats' empty state when the filter excludes every row", () => {
    act(() => {
      const id = usePublicChatStore.getState().createSession();
      usePublicChatStore.getState().appendUserTurn(id, "Recipe ideas");
    });

    renderPanel("/", "spaceships");

    expect(screen.getByText("No matching chats")).toBeInTheDocument();
    expect(screen.queryByText("Recipe ideas")).not.toBeInTheDocument();
  });
});
