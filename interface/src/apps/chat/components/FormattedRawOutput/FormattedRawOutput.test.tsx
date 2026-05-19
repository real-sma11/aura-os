import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormattedRawOutput } from "./FormattedRawOutput";

describe("FormattedRawOutput", () => {
  it("renders a basic tool marker as a status row", () => {
    render(<FormattedRawOutput buffer="[tool: read_file(src/db.rs) -> ok]" />);

    const row = screen.getByText("Read `src/db.rs`").closest("[data-status]");
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute("data-status", "ok");
    expect(screen.queryByText(/\[tool:/)).not.toBeInTheDocument();
  });

  it("hoists a nested-paren search_code marker into a tool row", () => {
    render(
      <FormattedRawOutput
        buffer={
          "[tool: search_code(pub fn (ack|mark_attempt|next_due|len|is_empty|contains), context=1) → ok]"
        }
      />,
    );

    const row = screen
      .getByText(/^Search: pub fn \(ack\|mark_attempt/)
      .closest("[data-status]");
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute("data-status", "ok");
    expect(screen.queryByText(/\[tool:/)).not.toBeInTheDocument();
  });

  it("does not bleed a nested-paren arg into a sibling marker on the same line", () => {
    render(
      <FormattedRawOutput
        buffer={
          "[tool: search_code(pub (struct|fn|enum), context=2) → ok] [tool: read_file(src/db.rs) → ok]"
        }
      />,
    );

    expect(
      screen.getByText(/^Search: pub \(struct\|fn\|enum\), context=2/),
    ).toBeInTheDocument();
    expect(screen.getByText("Read `src/db.rs`")).toBeInTheDocument();
    expect(screen.queryByText(/\[tool:/)).not.toBeInTheDocument();
  });
});
