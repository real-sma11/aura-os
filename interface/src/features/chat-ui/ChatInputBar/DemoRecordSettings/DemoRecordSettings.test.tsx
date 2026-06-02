import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemoRecordSettings } from "./DemoRecordSettings";
import {
  DEFAULT_DEMO_RECORD_OPTIONS,
  type DemoRecordOptions,
} from "../../../../shared/api/desktop";

function setup(overrides: Partial<DemoRecordOptions> = {}) {
  const value: DemoRecordOptions = {
    ...DEFAULT_DEMO_RECORD_OPTIONS,
    ...overrides,
  };
  const onChange = vi.fn();
  const onPickBackground = vi.fn();
  render(
    <DemoRecordSettings
      value={value}
      onChange={onChange}
      onPickBackground={onPickBackground}
    />,
  );
  return { value, onChange, onPickBackground };
}

describe("DemoRecordSettings", () => {
  it("renders the controlled values from props", () => {
    setup({ resolution: "720p", target: "raw", backgroundPath: null });

    expect(
      (screen.getByLabelText("Recording resolution") as HTMLSelectElement)
        .value,
    ).toBe("720p");
    expect(
      (screen.getByLabelText("Output format") as HTMLSelectElement).value,
    ).toBe("raw");
    expect(screen.getByText("Default")).toBeInTheDocument();
  });

  it("shows the chosen background file name", () => {
    setup({ backgroundPath: "C:\\images\\my-bg.png" });
    expect(screen.getByText("my-bg.png")).toBeInTheDocument();
  });

  it("emits onChange when the resolution changes", async () => {
    const user = userEvent.setup();
    const { value, onChange } = setup();

    await user.selectOptions(
      screen.getByLabelText("Recording resolution"),
      "1440p",
    );
    expect(onChange).toHaveBeenCalledWith({ ...value, resolution: "1440p" });
  });

  it("toggles window-on-background through onChange", async () => {
    const user = userEvent.setup();
    const { value, onChange } = setup({ windowOnBackground: true });

    const toggle = screen.getByRole("switch", {
      name: "Frame window on background",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);
    expect(onChange).toHaveBeenCalledWith({
      ...value,
      windowOnBackground: false,
    });
  });

  it("calls onPickBackground when Choose is clicked", async () => {
    const user = userEvent.setup();
    const { onPickBackground } = setup();

    await user.click(
      screen.getByRole("button", { name: "Choose background image" }),
    );
    expect(onPickBackground).toHaveBeenCalledOnce();
  });
});
