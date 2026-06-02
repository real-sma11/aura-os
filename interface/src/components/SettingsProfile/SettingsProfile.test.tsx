import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChangeEvent, ReactNode } from "react";

// zui is stubbed here, matching the codebase convention for modal-bearing
// component tests (BuyCreditsModal, OrgSettingsPanel, AppsModal, …): the real
// zui Modal cannot mount under jsdom (React-duplication in the test env). This
// suite verifies SettingsProfile's own logic — native gating, the open/confirm
// flow, and error handling. The real modal's rendering is exercised visually
// on the native build.
const { mockUseAuraCapabilities, mockDeleteAccount, mockLogout } = vi.hoisted(() => ({
  mockUseAuraCapabilities: vi.fn(() => ({ isNativeApp: true })),
  mockDeleteAccount: vi.fn(),
  mockLogout: vi.fn(),
}));

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, onClick, disabled }: { children?: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
  Input: ({ value, onChange, placeholder, disabled }: { value?: string; onChange?: (e: ChangeEvent<HTMLInputElement>) => void; placeholder?: string; disabled?: boolean }) => (
    <input value={value ?? ""} onChange={onChange ?? (() => {})} placeholder={placeholder} disabled={disabled} />
  ),
  Textarea: ({ value, onChange, placeholder }: { value?: string; onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void; placeholder?: string }) => (
    <textarea value={value ?? ""} onChange={onChange ?? (() => {})} placeholder={placeholder} />
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Modal: ({ isOpen, title, children, footer }: { isOpen: boolean; title?: string; children?: ReactNode; footer?: ReactNode }) =>
    isOpen ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null,
}));

vi.mock("../OrgSettingsPanel/OrgSettingsPanel.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("./DeleteAccountConfirmModal.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../../stores/auth-store", () => {
  const state = { deleteAccount: mockDeleteAccount, logout: mockLogout };
  const useAuthStore = Object.assign(
    (sel: (s: typeof state) => unknown) => sel(state),
    { getState: () => state },
  );
  return { useAuthStore };
});

vi.mock("../../stores/profile-store", () => {
  const profile = { name: "Test", bio: "", website: "", location: "", handle: "test", avatarUrl: "" };
  const state = { init: vi.fn() };
  const useProfileStore = Object.assign(
    (sel: (s: typeof state) => unknown) => sel(state),
    { getState: () => state },
  );
  return { useProfile: () => ({ profile, updateProfile: vi.fn() }), useProfileStore };
});

vi.mock("../../api/upload", () => ({ uploadFile: vi.fn() }));
vi.mock("../ImageCropModal", () => ({ ImageCropModal: () => null }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

import { SettingsProfile } from "./SettingsProfile";

function confirmButton(): HTMLElement {
  // After the modal opens there are two "Delete Account" buttons: the trigger
  // in the settings row and the confirm button inside the modal (last in DOM).
  const buttons = screen.getAllByRole("button", { name: "Delete Account" });
  return buttons[buttons.length - 1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuraCapabilities.mockReturnValue({ isNativeApp: true });
});

describe("SettingsProfile — delete account", () => {
  it("hides the account actions outside the native app", () => {
    mockUseAuraCapabilities.mockReturnValue({ isNativeApp: false });
    render(<SettingsProfile />);
    expect(screen.queryByRole("button", { name: "Delete Account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log Out" })).not.toBeInTheDocument();
  });

  it("shows Log Out and Delete Account in the native app", () => {
    render(<SettingsProfile />);
    expect(screen.getByRole("button", { name: "Log Out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Account" })).toBeInTheDocument();
  });

  it("logs out when Log Out is tapped", async () => {
    const user = userEvent.setup();
    mockLogout.mockResolvedValue(undefined);
    render(<SettingsProfile />);

    await user.click(screen.getByRole("button", { name: "Log Out" }));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("opens a permanent-deletion confirmation and deletes on confirm", async () => {
    const user = userEvent.setup();
    mockDeleteAccount.mockResolvedValue(undefined);
    render(<SettingsProfile />);

    await user.click(screen.getByRole("button", { name: "Delete Account" }));

    expect(screen.getByRole("dialog", { name: "Delete Account" })).toBeInTheDocument();
    expect(screen.getByText(/won.?t be able to recover/i)).toBeInTheDocument();

    await user.click(confirmButton());
    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
  });

  it("surfaces an error and keeps the user when deletion fails", async () => {
    const user = userEvent.setup();
    mockDeleteAccount.mockRejectedValue(new Error("nope"));
    render(<SettingsProfile />);

    await user.click(screen.getByRole("button", { name: "Delete Account" }));
    await user.click(confirmButton());

    expect(await screen.findByText(/Couldn.t delete your account/i)).toBeInTheDocument();
    // Modal stays open so the user can retry; nothing navigated away.
    expect(screen.getByRole("dialog", { name: "Delete Account" })).toBeInTheDocument();
  });
});
