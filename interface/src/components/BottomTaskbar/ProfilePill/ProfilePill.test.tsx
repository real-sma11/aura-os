import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./ProfilePill.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("./PlanBadge.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProfilePill } from "./ProfilePill";

describe("ProfilePill", () => {
  it("renders the supplied name", () => {
    render(<ProfilePill name="Ada Lovelace" onOpenSettings={() => {}} />);

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("falls back to the User icon when avatarUrl is missing", () => {
    render(<ProfilePill name="Ada Lovelace" onOpenSettings={() => {}} />);

    // No <img> means the Avatar fell back to the User lucide icon.
    const button = screen.getByRole("button", { name: "Open settings" });
    expect(button.querySelector("img")).toBeNull();
  });

  it("calls onOpenSettings on click", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();

    render(<ProfilePill name="Ada Lovelace" onOpenSettings={onOpenSettings} />);

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("exposes accessible name 'Open settings' via aria-label", () => {
    render(<ProfilePill name="Ada Lovelace" onOpenSettings={() => {}} />);

    expect(
      screen.getByRole("button", { name: "Open settings" }),
    ).toBeInTheDocument();
  });

  it("falls back to 'Sign in' label when name is empty", () => {
    render(<ProfilePill name="" onOpenSettings={() => {}} />);

    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });

  describe("plan badge", () => {
    it("renders no badge when plan is undefined", () => {
      const { container } = render(
        <ProfilePill name="Ada Lovelace" onOpenSettings={() => {}} />,
      );

      expect(container.querySelector("[data-plan]")).toBeNull();
    });

    it("renders no badge when plan is mortal", () => {
      const { container } = render(
        <ProfilePill name="Ada Lovelace" onOpenSettings={() => {}} plan="mortal" />,
      );

      expect(container.querySelector("[data-plan]")).toBeNull();
    });

    it("renders the Pro badge when plan is pro", () => {
      const { container } = render(
        <ProfilePill name="Ada Lovelace" onOpenSettings={() => {}} plan="pro" />,
      );

      const badge = container.querySelector('[data-plan="pro"]');
      expect(badge).not.toBeNull();
      expect(screen.getByLabelText("Pro subscriber")).toBeInTheDocument();
    });

    it("renders the Crusader badge when plan is crusader", () => {
      const { container } = render(
        <ProfilePill name="Ada Lovelace" onOpenSettings={() => {}} plan="crusader" />,
      );

      const badge = container.querySelector('[data-plan="crusader"]');
      expect(badge).not.toBeNull();
      expect(screen.getByLabelText("Crusader subscriber")).toBeInTheDocument();
    });

    it("renders the Sage badge when plan is sage", () => {
      const { container } = render(
        <ProfilePill name="Ada Lovelace" onOpenSettings={() => {}} plan="sage" />,
      );

      const badge = container.querySelector('[data-plan="sage"]');
      expect(badge).not.toBeNull();
      expect(screen.getByLabelText("Sage subscriber")).toBeInTheDocument();
    });
  });
});
