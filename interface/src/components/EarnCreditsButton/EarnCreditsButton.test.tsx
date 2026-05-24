import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const openInviteModal = vi.fn();
const closeInviteModal = vi.fn();

const uiModalState = {
  inviteModalOpen: false,
  openInviteModal,
  closeInviteModal,
};

vi.mock("../../stores/ui-modal-store", () => ({
  useUIModalStore: (selector: (state: typeof uiModalState) => unknown) =>
    selector(uiModalState),
}));

vi.mock("../InviteModal/InviteModal", () => ({
  InviteModal: () => null,
}));

vi.mock("./EarnCreditsButton.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { EarnCreditsButton } from "./EarnCreditsButton";

beforeEach(() => {
  vi.clearAllMocks();
  uiModalState.inviteModalOpen = false;
});

describe("EarnCreditsButton", () => {
  it("renders the 'Refer member, earn $50.' label", () => {
    render(<EarnCreditsButton />);

    expect(screen.getByText("Refer member, earn $50.")).toBeInTheDocument();
  });

  it("calls openInviteModal when the button is clicked", async () => {
    const user = userEvent.setup();

    render(<EarnCreditsButton />);

    await user.click(
      screen.getByRole("button", { name: "Refer a member to earn credits" }),
    );

    expect(openInviteModal).toHaveBeenCalledTimes(1);
  });

  it("exposes the accessible name via aria-label", () => {
    render(<EarnCreditsButton />);

    expect(
      screen.getByRole("button", { name: "Refer a member to earn credits" }),
    ).toBeInTheDocument();
  });
});
