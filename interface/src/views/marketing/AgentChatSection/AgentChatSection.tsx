import { type ReactNode } from "react";
import { PhoneShell } from "../PhoneShell";
import { Section } from "../Section";
import "./AgentChatSection.css";

const HEADLINE_ID = "agentChatSectionHeadline";

/**
 * First themed section built on the shared marketing `<Section />`
 * shell. Mirrors the Apple iPhone 17 hero layout: a centered
 * headline at the top, three phones below it (the middle one
 * larger and lifted forward so it visually overlaps the two side
 * phones), and a writing block at the bottom.
 *
 * The phones are placeholder shells in v1 — each `PhoneShell`
 * renders the device frame + notch and a faint skeleton inside
 * its screen. Real mobile mock interfaces (a thumb-friendly
 * version of the desktop chat surface) will land in a follow-up
 * and be passed as children to each `PhoneShell`.
 *
 * On narrow viewports (<= 768px) `AgentChatSection.css` hides the
 * two side phones so only the centered hero phone remains, which
 * keeps the section legible on mobile without trying to squeeze a
 * desktop-style 3-phone row into a phone width.
 */
export function AgentChatSection(): ReactNode {
  return (
    <Section ariaLabelledBy={HEADLINE_ID}>
      <div className="agentChatSectionInner">
        <h2 id={HEADLINE_ID} className="agentChatSectionHeadline">
          Chat with your agents.
          <br />
          From anywhere.
        </h2>
        <div className="agentChatSectionPhones">
          <PhoneShell size="md" />
          <PhoneShell size="lg" />
          <PhoneShell size="md" />
        </div>
        <p className="agentChatSectionDescription">
          Your AURA agents are always on. Pick up a conversation on
          your phone, your laptop, or your desktop — they remember
          everything and bring the same tools with them, wherever
          you are.
        </p>
      </div>
    </Section>
  );
}
