/**
 * Phase 5 client-side stream-close breadcrumb.
 *
 * Every stream lifecycle terminator in the chat UI calls this helper
 * with a structured `reason`. The implementation is intentionally
 * tiny: in dev builds we additionally log to the browser console,
 * in all builds we dispatch a `CustomEvent("aura:stream-close")`
 * so a future telemetry handler (or an in-app "recent issues"
 * surface) can subscribe without having to re-read every consumer of
 * `useChatStream`, AND we persist the entry into a 50-slot ring
 * buffer (`stream-breadcrumbs-store`) so the `ReportBugButton`
 * surface can grab the recent tail without rehydrating from a
 * network roundtrip.
 *
 * The matching server-side counter (`client_auto_retry_streamdropped`
 * via the `X-Aura-Client-Retry` header) is bumped from
 * `instance_route::send_event_stream`.
 */

import { appendBreadcrumb } from "../../stores/stream-breadcrumbs-store";

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
 * the server. `support_id` is the 12-hex stamp the server appends to
 * `ErrorMsg.message` (parsed back out on the client via
 * `extractSupportId`); when present it joins the breadcrumb back to
 * the server-side `tracing` span that emitted the error.
 */
export interface StreamCloseReason {
  classified: StreamCloseClassification;
  message: string;
  code?: string;
  auto_retry?: boolean;
  support_id?: string;
}

/**
 * Optional context the chat hooks can thread through the breadcrumb.
 * Lives in a separate object (rather than being inlined into
 * {@link StreamCloseReason}) so the lifecycle handlers — which today
 * have no awareness of agentId / sessionId — can keep their existing
 * call sites and have the use-site (the chat hook) supply the
 * context as a closure capture. Mirrors the optionality of the
 * fields on {@link import("../../stores/stream-breadcrumbs-store").StreamBreadcrumb }.
 */
export interface StreamCloseContext {
  streamKey?: string;
  agentId?: string;
  sessionId?: string;
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
 *
 * The `process` reference is guarded behind a `globalThis` lookup
 * because the production `tsconfig` does not include `@types/node`
 * (the bundle is browser-only). A direct `process.env` reference
 * trips TS2591 under that config; the indirect access via
 * `globalThis` keeps the runtime fallback while satisfying the
 * browser-only type universe.
 */
function isDevBuild(): boolean {
  // `import.meta.env` is Vite-specific; guard for environments
  // (Node-side tests, isolated bundles) that don't define it.
  type DevEnv = { env?: { DEV?: boolean } };
  const meta = import.meta as unknown as DevEnv;
  if (meta && meta.env && typeof meta.env.DEV === "boolean") {
    return meta.env.DEV;
  }
  type MaybeProcessHost = { process?: { env?: { NODE_ENV?: string } } };
  const host = globalThis as unknown as MaybeProcessHost;
  if (host.process && host.process.env && host.process.env.NODE_ENV === "development") {
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
 * - In all builds, persists the breadcrumb into the
 *   `stream-breadcrumbs-store` ring (50-entry oldest-drop) so the
 *   `ReportBugButton` pre-fill can grab the recent tail without a
 *   network roundtrip. The optional `context` arg threads the
 *   stream key / agent / session ids that are only available at
 *   the hook use-site (the lifecycle handlers don't know them).
 * - In all builds, dispatches a `CustomEvent` named
 *   {@link STREAM_CLOSE_EVENT} with the reason in `detail` (NOT the
 *   context — the event payload stays backwards-compatible for
 *   existing telemetry handlers wiring to `aura:stream-close`).
 *
 * Safe in non-DOM environments (jsdom, SSR, Node-side bundles): if
 * `window` is undefined we skip the dispatch and only log + persist.
 */
export function recordStreamCloseReason(
  reason: StreamCloseReason,
  context?: StreamCloseContext,
): void {
  if (isDevBuild() && typeof console !== "undefined") {
    // Plain key-value log instead of a templated string so the
    // console pretty-prints the reason as a structured object —
    // makes it easy to expand in DevTools.
    console.info("[stream-close]", reason, context);
  }
  // Persist FIRST so a flaky `dispatchEvent` listener can't blow
  // the ring write. Wrapped in try/catch so a Zustand setState
  // exception (extremely unlikely, but possible if the store
  // module fails to load) cannot cascade into chat-hook breakage —
  // breadcrumbs are observational only.
  try {
    appendBreadcrumb({
      ts: Date.now(),
      classified: reason.classified,
      code: reason.code,
      support_id: reason.support_id,
      message: reason.message,
      streamKey: context?.streamKey,
      agentId: context?.agentId,
      sessionId: context?.sessionId,
    });
  } catch {
    // Persist failures are non-fatal. The CustomEvent dispatch
    // below still runs so any in-process telemetry listener still
    // sees the close reason.
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
