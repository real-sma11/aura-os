import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useUpdateStatusMock = vi.fn();

vi.mock("./useUpdateStatus", async () => {
  const actual =
    await vi.importActual<typeof import("./useUpdateStatus")>("./useUpdateStatus");
  return {
    ...actual,
    useUpdateStatus: () => useUpdateStatusMock(),
  };
});

const useAuraCapabilitiesMock = vi.fn();
vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => useAuraCapabilitiesMock(),
}));

const apiOpenPathMock = vi.fn();
vi.mock("../../api/client", () => ({
  api: {
    openPath: (...args: unknown[]) => apiOpenPathMock(...args),
  },
}));

import { UpdateControl } from "./UpdateControl";

const relocateAndRelaunch = vi.fn(() => Promise.resolve());
const checkForUpdates = vi.fn(() => Promise.resolve());
const installUpdate = vi.fn(() => Promise.resolve());
const revealUpdaterLogs = vi.fn(() => Promise.resolve());

interface PartialState {
  status?: string;
  error?: string | null;
  lastStep?: string | null;
  bundleInfo?: unknown;
  isFailed?: boolean;
  relocatePending?: boolean;
}

function setMockState(overrides: PartialState = {}) {
  useUpdateStatusMock.mockReturnValue({
    supported: true,
    loaded: true,
    status: overrides.status ?? "failed",
    currentVersion: "1.0.0",
    availableVersion: null,
    error: overrides.error ?? "update install failed: Read-only file system (os error 30)",
    lastStep: overrides.lastStep ?? "preflight_failed",
    lastCheckedAt: null,
    bundleInfo: overrides.bundleInfo ?? null,
    checkPending: false,
    installPending: false,
    revealPending: false,
    relocatePending: overrides.relocatePending ?? false,
    checkForUpdates,
    installUpdate,
    revealUpdaterLogs,
    relocateAndRelaunch,
  });
}

beforeEach(() => {
  useAuraCapabilitiesMock.mockReturnValue({
    features: { nativeUpdater: true },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("UpdateControl macOS read-only recovery", () => {
  it("renders the generic failure message when no bundleInfo is available", () => {
    setMockState({ bundleInfo: null });
    render(<UpdateControl />);
    expect(screen.getByTestId("settings-update-failed")).toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-update-failed-mac-readonly"),
    ).not.toBeInTheDocument();
    // The generic step label + "Try again" should still appear.
    expect(
      screen.getByTestId("settings-update-failed-step"),
    ).toHaveTextContent(/Stopped at: Preflight Failed/i);
    expect(
      screen.getByTestId("settings-update-retry"),
    ).toBeInTheDocument();
  });

  it("renders the macOS recovery block when the running bundle is translocated", () => {
    setMockState({
      bundleInfo: {
        ok: true,
        supported: true,
        path: "/private/var/folders/abc/AppTranslocation/UUID/d/Aura.app",
        translocated: true,
        read_only: true,
        on_dmg: false,
      },
    });
    render(<UpdateControl />);

    expect(
      screen.getByTestId("settings-update-failed-mac-readonly"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("settings-update-failed-mac-readonly-explanation"),
    ).toHaveTextContent(/App Translocation/i);
    // The big "Try again" button is suppressed in favour of the
    // primary "Move to /Applications" recovery action.
    expect(
      screen.queryByTestId("settings-update-retry"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("settings-update-failed-mac-relocate"),
    ).toBeEnabled();
  });

  it("invokes relocateAndRelaunch when the primary button is clicked", async () => {
    const user = userEvent.setup();
    setMockState({
      bundleInfo: {
        ok: true,
        supported: true,
        path: "/private/var/folders/abc/AppTranslocation/UUID/d/Aura.app",
        translocated: true,
        read_only: true,
        on_dmg: false,
      },
    });
    render(<UpdateControl />);

    const button = screen.getByTestId("settings-update-failed-mac-relocate");
    await user.click(button);
    expect(relocateAndRelaunch).toHaveBeenCalledTimes(1);
  });

  it("opens the bundle path in Finder when 'Reveal in Finder' is clicked", async () => {
    const user = userEvent.setup();
    apiOpenPathMock.mockResolvedValue({ ok: true });
    setMockState({
      bundleInfo: {
        ok: true,
        supported: true,
        path: "/Volumes/Aura/Aura.app",
        translocated: false,
        read_only: true,
        on_dmg: true,
      },
    });
    render(<UpdateControl />);

    expect(
      screen.getByTestId("settings-update-failed-mac-readonly-explanation"),
    ).toHaveTextContent(/mounted disk image/i);

    const reveal = screen.getByTestId("settings-update-failed-mac-reveal-bundle");
    await user.click(reveal);
    expect(apiOpenPathMock).toHaveBeenCalledWith("/Volumes/Aura/Aura.app");
  });

  it("disables the primary button while relocate is pending", () => {
    setMockState({
      relocatePending: true,
      bundleInfo: {
        ok: true,
        supported: true,
        path: "/private/var/folders/abc/AppTranslocation/UUID/d/Aura.app",
        translocated: true,
        read_only: true,
        on_dmg: false,
      },
    });
    render(<UpdateControl />);
    const button = screen.getByTestId("settings-update-failed-mac-relocate");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/Moving/i);
  });

  it("renders nothing for the panel layout on a healthy state", () => {
    setMockState({
      status: "up_to_date",
      isFailed: false,
      error: null,
    });
    const { container } = render(<UpdateControl layout="panel" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the macOS recovery block in the panel layout when translocated", () => {
    setMockState({
      bundleInfo: {
        ok: true,
        supported: true,
        path: "/private/var/folders/abc/AppTranslocation/UUID/d/Aura.app",
        translocated: true,
        read_only: true,
        on_dmg: false,
      },
    });
    render(<UpdateControl layout="panel" />);
    expect(
      screen.getByTestId("settings-update-panel-failed-mac-readonly"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("settings-update-panel-failed-mac-relocate"),
    ).toBeEnabled();
  });
});
