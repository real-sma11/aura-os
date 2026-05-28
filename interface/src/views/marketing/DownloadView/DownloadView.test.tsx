import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { DownloadView } from "./DownloadView";

function renderDownloadView() {
  return render(
    <MemoryRouter>
      <DownloadView />
    </MemoryRouter>,
  );
}

describe("DownloadView", () => {
  it("renders the page headline", () => {
    renderDownloadView();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /Download AURA for every major desktop platform/i,
      }),
    ).toBeInTheDocument();
  });

  it("renders all four platform cards", () => {
    renderDownloadView();
    for (const name of ["Apple Silicon", "Intel Mac", "Windows", "Linux"]) {
      expect(
        screen.getByRole("heading", { level: 2, name }),
      ).toBeInTheDocument();
    }
  });

  it("links each card to the matching per-platform download path", () => {
    renderDownloadView();
    // Multiple cards share the "Download" CTA label; assert by href
    // from the rendered anchors to keep the matrix precise without
    // relying on positional matchers.
    const links = screen
      .getAllByRole("link", { name: /Download/ })
      .map((link) => link.getAttribute("href"));
    expect(links).toEqual(
      expect.arrayContaining([
        "/download/mac/apple-silicon",
        "/download/mac/intel",
        "/download/windows",
        "/download/linux",
      ]),
    );
  });
});
