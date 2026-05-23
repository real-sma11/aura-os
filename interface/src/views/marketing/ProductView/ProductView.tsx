import { type ReactNode, useEffect } from "react";
import { ChangelogPreview } from "../ChangelogPreview";
import {
  CodeIcon,
  FeaturePanel,
  LockIcon,
  ShieldIcon,
} from "../FeaturePanel/FeaturePanel";
import { CreateAgentButton } from "../../public-chat/CreateAgentButton";
import { TypewriterText } from "../../public-chat/TypewriterText";
import { PageHero } from "../PageHero";
import { ProductCallToAction } from "../ProductCallToAction";
import { ProductScreenSection } from "../ProductScreenSection";
import styles from "./ProductView.module.css";

/*
 * The hero copy is hoisted into a module-level constant because it
 * is referenced in TWO places that must stay byte-identical:
 *
 *   1. The `text` prop on `<TypewriterText />`, which drives the
 *      per-character reveal.
 *   2. The `data-text` attribute on the `.headlineReserve` wrapper,
 *      which the CSS rule mirrors into a `::before` ghost via
 *      `content: attr(data-text)` so the parent flex column reserves
 *      the FINAL headline's width/height from frame one. Without
 *      that reservation the description + headlineCta + flowing
 *      video below the headline would shift downward each time a
 *      newly-typed character forces an extra line wrap under the
 *      `clamp(26px, 4.3vw, 48px)` type ramp.
 *
 * Pulling the literal into a constant means a future copy change
 * cannot drift the ghost and the streamed text out of sync.
 */
const HERO_HEADLINE = "Your Personal Agent.";

/**
 * Marketing `/product` page. Ported from
 * `aura-web/src/app/product/page.tsx` as a pure JSX composition of the
 * shared marketing components. The page-level chrome (titlebar /
 * sidebar / footer / scrollable column) is owned by the public-mode
 * `AuraShell` + `PublicMarketingPanel`, so this component only
 * renders the section stack.
 */
export function ProductView(): ReactNode {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "AURA - Product";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className={styles.productView}>
      <PageHero
        headline={
          <span
            className={styles.headlineReserve}
            data-text={HERO_HEADLINE}
          >
            <TypewriterText text={HERO_HEADLINE} speedMs={45} />
          </span>
        }
        description="AURA agents run on a secure virtual machine that is yours, keeping your data completely secure."
        preview={null}
        centered
        backgroundVideoSrc="/AURA_visual_loop.mp4"
        headlineCta={<CreateAgentButton />}
      />
      <ProductScreenSection
        headline="A secure operating system to manage agentic swarms."
        placeholderLabel="AURA desktop interface"
        imageSrc="/product-screens/aura-product-screen-desktop.png"
        imageAlt="AURA desktop interface showing an operating system workspace"
      />
      <ProductScreenSection
        headline="Spawn a team of agents that run your company while you sleep."
        placeholderLabel="AURA agents interface"
        imageSrc="/product-screens/aura-product-screen-superagent.png"
        imageAlt="AURA agents interface showing autonomous agents"
      />
      <ProductScreenSection
        headline="Ship complex software that improves autonomously."
        placeholderLabel="AURA software automation interface"
        imageSrc="/product-screens/aura-product-screen-automation.png"
        imageAlt="AURA software automation interface showing autonomous development workflows"
      />
      <ProductScreenSection
        headline="Deploy agentic processes for every workflow."
        placeholderLabel="AURA process interface"
        imageSrc="/product-screens/aura-product-screen-process.png"
        imageAlt="AURA process interface showing agentic workflow processes"
      />
      <FeaturePanel
        label="SOVEREIGN"
        headline="Private by Design."
        features={[
          {
            icon: <LockIcon />,
            title: "Private",
            description:
              "AURA does not view or train on your personal or corporate data. Data sent to frontier model providers is not directly identifiable.",
          },
          {
            icon: <ShieldIcon />,
            title: "Secure",
            description:
              "The AURA harness and kernel is built from the ground up with security, verification and policy enforcement as first class citizens.",
          },
          {
            icon: <CodeIcon />,
            title: "Open Source",
            description:
              "AURA is 100% open source under the MIT license. Fork it at anytime with zero vendor lock-in.",
          },
        ]}
      />
      <ChangelogPreview />
      <ProductCallToAction href="/download" label="DOWNLOAD" />
    </div>
  );
}
