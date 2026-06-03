import { useEffect, useRef } from "react";

import { track } from "../../lib/analytics";
import { selectShouldShowGate, usePublicChatStore } from "../../stores/public-chat-store";

/**
 * Fires `public_page_viewed` once when a public (logged-out) surface mounts.
 *
 * Restores the event that `LoggedOutShell` fired before the public-chat
 * refactor deleted it. Called from every public web surface — `PublicChatView`
 * and `MobilePublicChatView` (chat) and `PublicMarketingPanel` (marketing) — so
 * it counts ALL anonymous visitors, not just those who land on chat. The metric
 * is uniques-per-day, so a visitor who browses several surfaces still counts
 * once.
 */
export function usePublicPageViewed(): void {
  useEffect(() => {
    track("public_page_viewed");
  }, []);
}

/**
 * Fires `public_gate_shown` once when the 3-turn gate trips.
 *
 * Restores the event the deleted `KeepChattingModal` fired on mount — it only
 * rendered while `selectShouldShowGate` (`turnCount >= limit`) was true, so we
 * fire on the same condition. Chat-only: the gate exists solely in the public
 * chat surfaces.
 */
export function usePublicGateShown(): void {
  const shouldShowGate = usePublicChatStore(selectShouldShowGate);
  const gateTracked = useRef(false);

  useEffect(() => {
    if (shouldShowGate && !gateTracked.current) {
      gateTracked.current = true;
      track("public_gate_shown");
    }
  }, [shouldShowGate]);
}
