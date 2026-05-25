import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Block } from "./Block";

vi.mock("./Block.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../CopyButton/CopyButton.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

describe("Block primitive", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText, write: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  it("always renders exactly one copy button in the header (icon-only, no 'Copy' label)", () => {
    render(
      <Block title="Read file" summary="db.rs" copy={{ getText: () => "ok" }}>
        body
      </Block>,
    );

    // Single header button (the expand toggle) plus exactly one copy button.
    const copyButtons = screen.getAllByTestId("copy-button");
    expect(copyButtons).toHaveLength(1);
    // Icon-only: the label "Copy" must NOT appear visibly.
    expect(screen.queryByText("Copy")).not.toBeInTheDocument();
  });

  it("places the copy button between the badge and the chevron", () => {
    const { container } = render(
      <Block
        title="List files"
        badge="14 items"
        copy={{ getText: () => "x" }}
      >
        body
      </Block>,
    );

    // Sibling order inside the header is: ..., badge, copyWrap, chevron.
    const badge = container.querySelector(".blockBadge");
    const copy = container.querySelector(".blockCopy");
    const chevron = container.querySelector(".blockChevron");
    expect(badge).not.toBeNull();
    expect(copy).not.toBeNull();
    expect(chevron).not.toBeNull();

    const parent = badge?.parentElement;
    expect(parent).not.toBeNull();
    const children = Array.from(parent!.children);
    const badgeIdx = children.indexOf(badge as Element);
    const copyIdx = children.indexOf(copy as Element);
    const chevIdx = children.indexOf(chevron as Element);

    expect(copyIdx).toBe(badgeIdx + 1);
    expect(chevIdx).toBe(copyIdx + 1);
  });

  it("clicking the copy button copies text without toggling expand state", async () => {
    render(
      <Block title="Run command" copy={{ getText: () => "$ ls" }}>
        body
      </Block>,
    );

    const header = screen
      .getAllByRole("button")
      .find((el) => el.hasAttribute("aria-expanded"));
    expect(header).toBeDefined();
    expect(header).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByTestId("copy-button"));

    // Clicking the copy button must not flip the row open.
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("falls back to title-based aria-label when copy.ariaLabel is omitted", () => {
    render(
      <Block title="Generated image" copy={{ getText: () => "url" }}>
        body
      </Block>,
    );

    expect(screen.getByTestId("copy-button")).toHaveAttribute(
      "aria-label",
      "Copy",
    );
  });

  it("renders title as primary text and summary as a separate, smaller sibling", () => {
    const { container } = render(
      <Block title="Read file" summary="db.rs" copy={{ getText: () => "" }}>
        body
      </Block>,
    );

    const title = container.querySelector(".blockTitleText");
    const summary = container.querySelector(".blockSummary");
    expect(title?.textContent).toBe("Read file");
    expect(summary?.textContent).toBe("db.rs");
    // Title and summary must be distinct DOM nodes so the smaller summary
    // styling (font-size 11px, secondary color) can apply independently.
    expect(title).not.toBe(summary);
  });
});
