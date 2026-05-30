/**
 * Vitest for `ConnectionTaskbar`. Verifies the connection-loss
 * affordance: when the realtime event socket is disconnected the
 * taskbar surfaces the standard Report bug flow alongside the
 * connection indicator.
 */

import { render, screen } from "@testing-library/react";
import { useEventStore } from "../../stores/event-store/index";

vi.mock("../../stores/event-store/index", () => {
  const store = {
    connected: true,
    lastEventAt: null as number | null,
    subscribe: vi.fn(() => vi.fn()),
  };
  const useEventStore = Object.assign(
    (selector: (s: typeof store) => unknown) => selector(store),
    {
      getState: () => store,
      setState: (patch: Partial<typeof store>) => Object.assign(store, patch),
      subscribe: vi.fn(),
    },
  );
  return { useEventStore };
});

vi.mock("../ConnectionDot/ConnectionDot.module.css", () => ({
  default: { connectionDot: "connectionDot" },
}));

vi.mock("./ConnectionTaskbar.module.css", () => ({
  default: { taskbar: "taskbar", status: "status" },
}));

vi.mock("../ReportBugButton", () => ({
  ReportBugButton: (props: { titleSuffix?: string }) => (
    <button type="button" aria-label="Report bug" data-title-suffix={props.titleSuffix ?? ""}>
      Report bug
    </button>
  ),
}));

import { ConnectionTaskbar } from "./ConnectionTaskbar";

function setStoreState(patch: { connected?: boolean; lastEventAt?: number | null }) {
  (useEventStore as unknown as { setState: (p: Record<string, unknown>) => void }).setState(patch);
}

beforeEach(() => {
  vi.useFakeTimers();
  setStoreState({ connected: true, lastEventAt: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ConnectionTaskbar", () => {
  it("does not show the Report bug flow while connected", () => {
    setStoreState({ connected: true });
    render(<ConnectionTaskbar />);
    expect(screen.queryByRole("button", { name: "Report bug" })).not.toBeInTheDocument();
  });

  it("surfaces the standard Report bug flow when disconnected", () => {
    setStoreState({ connected: false });
    render(<ConnectionTaskbar />);
    const reportButton = screen.getByRole("button", { name: "Report bug" });
    expect(reportButton).toBeInTheDocument();
    expect(reportButton).toHaveAttribute("data-title-suffix", "connection lost");
  });
});
