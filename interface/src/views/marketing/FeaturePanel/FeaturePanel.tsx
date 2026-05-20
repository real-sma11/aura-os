import { type ReactNode } from "react";
import "./FeaturePanel.css";

export interface FeaturePanelFeature {
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
}

interface FeaturePanelProps {
  readonly label: string;
  readonly headline: ReactNode;
  readonly features: readonly FeaturePanelFeature[];
}

/**
 * Ported verbatim from `aura-web/src/components/FeaturePanel/FeaturePanel.tsx`.
 * Renders a labelled grid of icon/title/description rows on the cream
 * panel surface. The inline `LockIcon` / `ShieldIcon` / `CodeIcon` exports
 * below are intentionally kept on this module so consumers don't need a
 * lucide dependency for the standard feature trio.
 */
export function FeaturePanel({
  label,
  headline,
  features,
}: FeaturePanelProps): ReactNode {
  return (
    <section className="featurePanel">
      <div className="featurePanelInner">
        <span className="featurePanelLabel">{label}</span>
        <h2 className="featurePanelHeadline">{headline}</h2>
        <ul className="featurePanelGrid" role="list">
          {features.map((feature, index) => (
            <li key={index} className="featurePanelItem">
              <span className="featurePanelIcon" aria-hidden="true">
                {feature.icon}
              </span>
              <h3 className="featurePanelItemTitle">{feature.title}</h3>
              <p className="featurePanelItemDesc">{feature.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function LockIcon(): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <rect x="4" y="10.5" width="16" height="10.5" />
      <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" />
    </svg>
  );
}

export function ShieldIcon(): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <path d="M12 3 4 6v6c0 4.5 3.2 8.4 8 9 4.8-.6 8-4.5 8-9V6l-8-3Z" />
    </svg>
  );
}

export function CodeIcon(): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <path d="m9 8-5 4 5 4" />
      <path d="m15 8 5 4-5 4" />
    </svg>
  );
}
