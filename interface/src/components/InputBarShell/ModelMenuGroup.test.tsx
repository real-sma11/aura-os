import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelMenuGroup } from "./ModelMenuGroup";

vi.mock("./InputBarShell.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

describe("ModelMenuGroup", () => {
  it("renders children and marks the header expanded when not collapsed", () => {
    render(
      <ModelMenuGroup label="Anthropic" collapsed={false} onToggle={vi.fn()}>
        <div>Opus 4.8</div>
      </ModelMenuGroup>,
    );

    expect(screen.getByText("Opus 4.8")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /anthropic/i }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("hides children and marks the header collapsed when collapsed", () => {
    render(
      <ModelMenuGroup label="OpenAI" collapsed onToggle={vi.fn()}>
        <div>GPT-5.5</div>
      </ModelMenuGroup>,
    );

    expect(screen.queryByText("GPT-5.5")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /openai/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("fires onToggle when the header is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ModelMenuGroup label="Open Source" collapsed={false} onToggle={onToggle}>
        <div>Kimi K2.6</div>
      </ModelMenuGroup>,
    );

    await user.click(screen.getByRole("button", { name: /open source/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
