import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PERSONAS } from "../../public-chat/personas";
import { AgentMarquee } from "./AgentMarquee";

/**
 * Smoke + contract coverage for the product-page agent marquee.
 *
 * The strip duplicates `PERSONAS` once in DOM so the CSS
 * `translateX(-50%)` keyframe wraps seamlessly. The tests assert
 * that contract directly: every persona's portrait + caption
 * renders TWICE inside the strip, and every duplicated card carries
 * the expected `Name, Role` aria-label so screen readers see two
 * passes worth of agents instead of half.
 */

describe("AgentMarquee", () => {
  it("renders two cards per persona for the seamless wrap", () => {
    render(<AgentMarquee />);
    const strip = screen.getByTestId("agent-marquee");
    for (const persona of PERSONAS) {
      const cards = within(strip).getAllByRole("img", {
        name: `${persona.name}, ${persona.role}`,
      });
      expect(cards).toHaveLength(2);
    }
  });

  it("uses each persona's desktop portrait as the card image", () => {
    render(<AgentMarquee />);
    const strip = screen.getByTestId("agent-marquee");
    for (const persona of PERSONAS) {
      const cards = within(strip).getAllByRole("img", {
        name: `${persona.name}, ${persona.role}`,
      });
      for (const card of cards) {
        // The card itself is the role="img" host with the
        // composite aria-label; the portrait <img> sits inside it.
        // We assert the inner image's `src` matches the persona's
        // canonical desktop portrait so a future asset rename
        // breaks the test loudly.
        const portrait = card.querySelector("img");
        expect(portrait).not.toBeNull();
        expect(portrait?.getAttribute("src")).toBe(
          persona.theme.desktopBackgroundUrl,
        );
      }
    }
  });

  it("makes every card keyboard-focusable", () => {
    render(<AgentMarquee />);
    const strip = screen.getByTestId("agent-marquee");
    // Every persona contributes 2 cards (the duplicated wrap), so
    // 6 personas × 2 = 12 focusable tiles. The check guards against
    // a future refactor that drops `tabIndex` and silently makes
    // the strip mouse-only.
    const focusable = within(strip).getAllByRole("img");
    expect(focusable).toHaveLength(PERSONAS.length * 2);
    for (const card of focusable) {
      expect(card.getAttribute("tabindex")).toBe("0");
    }
  });
});
