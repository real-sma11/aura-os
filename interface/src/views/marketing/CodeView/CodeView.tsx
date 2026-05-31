import { type ReactNode, useEffect } from "react";
import { ChangelogPreview } from "../ChangelogPreview";
import { ProductCallToAction } from "../ProductCallToAction";
import { ProductScreenSection } from "../ProductScreenSection";
import styles from "./CodeView.module.css";

/**
 * Marketing `/code` page. Hosts the product-screen sections that were
 * split out of `/agents` (the former `/product` page): the secure OS,
 * swarm-while-you-sleep, autonomous-shipping, and per-workflow process
 * stories. Shares the same Changelog + Download footer sections as the
 * Agents page. Page chrome (titlebar / sidebar / scrollable column) is
 * owned by the public-mode `AuraShell` + `PublicMarketingPanel`, so
 * this component only renders the section stack.
 */
export function CodeView(): ReactNode {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "AURA - Code";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className={styles.codeView}>
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
      <ChangelogPreview />
      <ProductCallToAction href="/download" label="DOWNLOAD" />
    </div>
  );
}
