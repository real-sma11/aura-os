import { useEffect } from "react";

import { DownloadCards } from "./DownloadCards";
import "./DownloadView.css";

/**
 * Marketing `/download` page. Ported from
 * `aura-web/src/app/download/page.tsx`. The page chrome (public-mode
 * `AuraShell` + `PublicMarketingPanel` scroll column) is owned by
 * the parent route; the page itself is just the headline +
 * `DownloadCards` grid + footnote. Sets `document.title` from a
 * mount effect (the Next.js `metadata` export pattern doesn't apply
 * in this Vite SPA), matching how the other ported marketing pages
 * (`PricingView`, etc.) manage the tab title.
 */
export function DownloadView(): React.ReactNode {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "AURA - Download";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <section className="downloadPage">
      <div className="downloadPageContent">
        <h1 className="downloadPageHeadline">
          Download AURA for every major desktop platform.
        </h1>
        <DownloadCards />
        <p className="downloadPageFootnote">
          Need a different release track? The site download routes can also be
          pointed at nightly or stable release manifests without changing the
          page layout.
        </p>
      </div>
    </section>
  );
}
