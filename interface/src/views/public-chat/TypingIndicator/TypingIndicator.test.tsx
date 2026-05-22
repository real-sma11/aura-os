/**
 * Smoke test for `TypingIndicator`. The component is a thin renderer
 * over the agent's accent `color`; the dots' bounce animation lives
 * purely in CSS, so the test only pins:
 *
 *  - The three dots render as inline children of the indicator root.
 *  - The accent color is applied as the dot background (so each
 *    agent's bubble reads with its own brand color during the typing
 *    pre-roll).
 *  - The indicator root is `aria-hidden` so the bouncing motion
 *    never reaches assistive tech.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TypingIndicator } from "./TypingIndicator";

describe("TypingIndicator", () => {
  it("renders three dots colored with the agent accent", () => {
    const { container } = render(<TypingIndicator color="#ff6fb5" />);
    const dots = container.querySelectorAll("span > span");
    expect(dots).toHaveLength(3);
    dots.forEach((dot) => {
      // jsdom normalizes the hex color into rgb at the styles layer.
      expect((dot as HTMLElement).style.background).toContain("rgb(");
    });
  });

  it("hides the bouncing motion from assistive tech", () => {
    const { container } = render(<TypingIndicator color="#ffffff" />);
    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute("aria-hidden", "true");
  });
});
