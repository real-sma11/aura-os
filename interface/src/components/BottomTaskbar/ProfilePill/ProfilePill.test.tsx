import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./ProfilePill.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProfilePill } from "./ProfilePill";

describe("ProfilePill", () => {
  it("renders name and plan when both are supplied", () => {
    render(
      <ProfilePill
        name="Ada Lovelace"
        plan="Pro"
        onOpenSettings={() => {}}
      />,
    );

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
  });

  it("hides the plan line when plan is undefined", () => {
    render(<ProfilePill name="Ada Lovelace" onOpenSettings={() => {}} />);

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    // The .plan span only renders when a plan is truthy.
    expect(screen.queryByText("Pro")).not.toBeInTheDocument();
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
});
