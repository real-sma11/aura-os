import { useState } from "react";

import {
  type DownloadTarget,
  getMacDownloadPath,
} from "./downloadTargets";

type DownloadPlatform = DownloadTarget | "unknown";

interface DownloadCard {
  readonly platform: DownloadTarget;
  readonly defaultForPlatform: boolean;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly cta: string;
  readonly meta: string;
}

const DOWNLOAD_CARDS: readonly DownloadCard[] = [
  {
    platform: "mac",
    defaultForPlatform: true,
    eyebrow: "macOS",
    title: "Apple Silicon",
    description: "Native build for M1, M2, M3, and M4 Macs.",
    href: getMacDownloadPath("apple-silicon"),
    cta: "Download",
    meta: "Recommended for most Macs",
  },
  {
    platform: "mac",
    defaultForPlatform: false,
    eyebrow: "macOS",
    title: "Intel Mac",
    description:
      "Desktop build for x86-based Macs and older MacBook Pro and iMac hardware.",
    href: getMacDownloadPath("intel"),
    cta: "Download",
    meta: "Only for pre-Apple Silicon Macs",
  },
  {
    platform: "windows",
    defaultForPlatform: true,
    eyebrow: "Windows",
    title: "Windows",
    description:
      "Signed Windows installer with the latest desktop runtime and updater support.",
    href: "/download/windows",
    cta: "Download",
    meta: "x64 installer",
  },
  {
    platform: "linux",
    defaultForPlatform: true,
    eyebrow: "Linux",
    title: "Linux",
    description:
      "Portable AppImage for Linux desktops, suitable for direct download and launch.",
    href: "/download/linux",
    cta: "Download",
    meta: "x86_64 AppImage",
  },
];

function detectDownloadPlatform(): DownloadPlatform {
  if (typeof window === "undefined") {
    return "unknown";
  }

  const navigatorWithUAData = window.navigator as Navigator & {
    userAgentData?: { platform?: string };
  };

  const platformSource = [
    navigatorWithUAData.userAgentData?.platform,
    window.navigator.platform,
    window.navigator.userAgent,
  ]
    .join(" ")
    .toLowerCase();

  if (platformSource.includes("win")) {
    return "windows";
  }

  if (
    platformSource.includes("mac") ||
    platformSource.includes("iphone") ||
    platformSource.includes("ipad") ||
    platformSource.includes("ipod")
  ) {
    return "mac";
  }

  if (
    platformSource.includes("linux") ||
    platformSource.includes("x11") ||
    platformSource.includes("ubuntu")
  ) {
    return "linux";
  }

  return "unknown";
}

/**
 * Four-card desktop download picker ported from
 * `aura-web/src/app/download/DownloadCards.tsx`. The detected
 * platform's primary card (`defaultForPlatform: true`) animates into
 * the recommended treatment after mount; every other card stays in
 * the default subdued state. Per-platform hrefs are kept as relative
 * paths (`/download/windows`, `/download/linux`,
 * `/download/mac/<variant>`) so the deployment layer can map them to
 * the actual installer artifacts (same posture as aura-web's server
 * routes).
 */
export function DownloadCards(): React.ReactNode {
  // Lazy initializer: the aura-web port deferred detection to a mount
  // effect to avoid hydration mismatches under Next.js SSR. The
  // aura-os interface is a Vite SPA — `window` is always defined at
  // render time — so we can read `navigator` straight from the
  // initializer and skip the setState-in-effect dance (which the
  // `react-hooks/set-state-in-effect` lint also forbids).
  const [platform] = useState<DownloadPlatform>(() => detectDownloadPlatform());

  return (
    <div className="downloadGrid">
      {DOWNLOAD_CARDS.map((card) => {
        const isPrimary =
          platform !== "unknown" &&
          card.platform === platform &&
          card.defaultForPlatform;

        return (
          <article
            key={card.title}
            className={`downloadCard${isPrimary ? " downloadCardRecommended" : ""}`}
            style={
              isPrimary
                ? { willChange: "background, border-color, box-shadow" }
                : undefined
            }
          >
            <div className="downloadCardBody">
              <div className="downloadCardHeading">
                <div className="downloadCardTitleRow">
                  <h2 className="downloadCardTitle">{card.title}</h2>
                </div>
                <span className="downloadCardEyebrow">{card.eyebrow}</span>
                <p className="downloadCardDescription">{card.description}</p>
              </div>
            </div>
            <div className="downloadCardFooter">
              <a
                href={card.href}
                className={`downloadCardButton${isPrimary ? " downloadCardButtonPrimary" : ""}`}
              >
                {card.cta}
              </a>
              <p className="downloadCardMeta">{card.meta}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
