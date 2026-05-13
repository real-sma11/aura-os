/**
 * Phase 5 client-side stream-close breadcrumb.
 *
 * Every stream lifecycle terminator in the chat UI calls this helper
 * with a structured `reason`. The implementation is intentionally
 * tiny: in dev builds we additionally log to the browser console,
 * and in all builds we dispatch a `CustomEvent("aura:stream-close")`
 * so a future telemetry handler (or an in-app "recent issues"
 * surface) can subscribe without having to re-read every consumer of
 * `useChatStream`.
 *
 * The matching server-side counter (`client_auto_retry_streamdropped`
 * via the `X-Aura-Client-Retry` header) is bumped from
 * `instance_route::send_event_stream`.
 */

/**
 * Operator-visible classification of the close reason. Matches the
 * five buckets the chat UI already maps from
 * `normalizeStreamError`'s `displayVariant` plus the Phase 2
 * auto-retry path; "completed" is the clean-finalize case so the
 * breadcrumb stream tells the same story as the SSE wire.
 *
 * Field order matches the operator dashboard's stack order, top
 * (best outcome) to bottom (worst outcome).
 */
export type StreamCloseClassification =
  | "completed"
  | "failed"
  | "disconnected"
  | "streamDropped"
  | "agentBusy"
  | "harnessCapacity"
  | "insufficientCredits";

/**
 * Wire shape of every breadcrumb. Carries the classified bucket plus
 * the original message and (optionally) the server-side error code
 * so a consumer can join the breadcrumb against the Rust
 * `ApiError::code` field. `auto_retry` is set by the Phase 2 retry
 * dispatcher to flag breadcrumbs that triggered a `streamDropped`
 * auto-retry POST — joins to `client_auto_retry_streamdropped` on
 * the server.
 */
export interface StreamCloseReason {
  classified: StreamCloseClassification;
  message: string;
  code?: string;
  auto_retry?: boolean;
}

/**
 * Name of the `CustomEvent` dispatched on every breadcrumb. Stable
 * — change this only if every consumer (telemetry handler, debug
 * tools) updates in the same release.
 */
export const STREAM_CLOSE_EVENT = "aura:stream-close" as const;

/**
 * Detect a Vite dev build. We check `import.meta.env.DEV` first
 * (Vite's idiomatic flag) and fall back to a `process.env.NODE_ENV`
 * check so the helper works under jsdom + Vitest, which polyfills
 * `process.env` even in browser-like environments.
 */
function isDevBuild(): boolean {
  // `import.meta.env` is Vite-specific; guard for environments
  // (Node-side tests, isolated bundles) that don't define it.
  type DevEnv = { env?: { DEV?: boolean } };
  const meta = import.meta as unknown as DevEnv;
  if (meta && meta.env && typeof meta.env.DEV === "boolean") {
    return meta.env.DEV;
  }
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
    return true;
  }
  return false;
}

/**
 * Record a stream-close breadcrumb.
 *
 * - In dev builds, logs the structured reason via `console.info` so
 *   the IDE devtools panel makes the close-reason surface naturally
 *   alongside the existing `console.error("Chat stream error:")`
 *   message in `lifecycle::handleStreamError`.
 * - In all builds, dispatches a `CustomEvent` named
 *   {@link STREAM_CLOSE_EVENT} with the reason in `detail`. A
 *   downstream handler (or the in-app "recent issues" view) listens
 *   to surface stream-close events without having to thread the
 *   reason through every consumer of `useChatStream`.
 *
 * Safe in non-DOM environments (jsdom, SSR, Node-side bundles): if
 * `window` is undefined we skip the dispatch and only log when in
 * dev builds.
 */
export function recordStreamCloseReason(reason: StreamCloseReason): void {
  if (isDevBuild() && typeof console !== "undefined") {
    // Plain key-value log instead of a templated string so the
    // console pretty-prints the reason as a structured object —
    // makes it easy to expand in DevTools.
    console.info("[stream-close]", reason);
  }
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") {
    return;
  }
  try {
    window.dispatchEvent(
      new CustomEvent<StreamCloseReason>(STREAM_CLOSE_EVENT, {
        detail: reason,
      }),
    );
  } catch {
    // Dispatch failures are non-fatal — the breadcrumb is purely
    // observational. We deliberately do not re-throw so a flaky
    // listener can't cascade into a chat hook regression.
  }
}
