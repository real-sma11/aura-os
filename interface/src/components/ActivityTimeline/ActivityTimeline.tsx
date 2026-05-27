import { memo, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TimelineItem, ToolCallEntry } from "../../shared/types/stream";
import { FILE_OPS } from "../../constants/tools";
import {
  stripEmojis,
  normalizeMidSentenceBreaks,
  flattenListIndentation,
  normalizeLooseStrongEmphasis,
} from "../../shared/utils/text-normalize";
import { ThinkingBlock, isAutoExpandedTool, renderToolBlock } from "../Block";
import { SegmentedContent } from "../SegmentedContent";
import { useScrollMargin } from "../../shared/hooks/use-scroll-margin";
import { canonicalInputKey, computeUniquePathTails } from "./grouping";
import styles from "./ActivityTimeline.module.css";

interface ActivityTimelineProps {
  timeline: TimelineItem[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
  toolCalls?: ToolCallEntry[];
  isStreaming: boolean;
  defaultThinkingExpanded?: boolean;
  defaultActivitiesExpanded?: boolean;
  /**
   * When provided, the timeline windows its rows via `@tanstack/react-virtual`,
   * using `scrollRef` as the scroll element. Mirrors the approach used by
   * `CompletedTaskOutput` so the task preview overlay stays fast on large
   * tool-heavy runs. When absent (chat surfaces, isolated tests) the
   * component falls back to a plain non-virtualized render.
   */
  scrollRef?: RefObject<HTMLElement | null>;
}

type ToolPosition = "first" | "mid" | "last" | "solo" | null;

interface RenderedItem {
  key: string;
  kind: "thinking" | "tool" | "text";
  toolPosition: ToolPosition;
  node: ReactNode;
}

/**
 * Per-row node wrapper. Wrapped in `React.memo` so streaming deltas that
 * mutate only the trailing item (new tokens on the last text/thinking
 * segment, a tool call flipping from pending to done) don't force every
 * previously-rendered row to re-execute its ReactMarkdown / syntax
 * highlight / Block render path. The keyed `node` ReactElement
 * identity is stable across renders when the underlying item has not
 * changed, so referential equality on `node` is a safe memo trigger.
 */
const TimelineRow = memo(function TimelineRow({ node }: { node: ReactNode }) {
  return <>{node}</>;
});

export function ActivityTimeline({
  timeline,
  thinkingText,
  thinkingDurationMs,
  toolCalls,
  isStreaming,
  defaultThinkingExpanded,
  defaultActivitiesExpanded,
  scrollRef,
}: ActivityTimelineProps) {
  const toolCallMap = useMemo(() => {
    const map = new Map<string, ToolCallEntry>();
    if (toolCalls) {
      for (const tc of toolCalls) map.set(tc.id, tc);
    }
    return map;
  }, [toolCalls]);

  // Consolidate contiguous `thinking` timeline entries into a single rendered
  // ThinkingBlock to avoid duplicate blocks when the stream briefly toggles
  // between thinking states. We walk the timeline twice: first to build a
  // merged list, then to apply the per-kind render rules below.
  const mergedTimeline: TimelineItem[] = [];
  for (const item of timeline) {
    const prev = mergedTimeline[mergedTimeline.length - 1];
    if (
      item.kind === "thinking" &&
      prev &&
      prev.kind === "thinking"
    ) {
      const mergedText = (prev.text ?? "") + (item.text ?? "");
      // Sum the per-segment durations when merging contiguous
      // thinking items so the combined block reflects the full
      // wall-clock spent thinking across both, not just one.
      const mergedDuration =
        prev.durationMs != null || item.durationMs != null
          ? (prev.durationMs ?? 0) + (item.durationMs ?? 0)
          : undefined;
      // Keep the earlier `startMs` so a still-open segment merge
      // (rare, but possible if both have `startMs` and no
      // `durationMs`) continues to measure from the original start.
      const mergedStart =
        prev.startMs != null
          ? prev.startMs
          : item.startMs;
      mergedTimeline[mergedTimeline.length - 1] = {
        ...prev,
        text: mergedText || undefined,
        startMs: mergedStart,
        durationMs: mergedDuration,
      };
      continue;
    }
    mergedTimeline.push(item);
  }

  // When the model emits zero `thinking_delta` blocks on the wire
  // (Opus-4 Adaptive default, plus any other path where the API
  // chooses not to surface reasoning) the user otherwise sees tool
  // blocks appear with no narration above them. Inject an open
  // placeholder thinking slot at the head of the merged timeline so
  // the standard Brain "Thinking..." Block renders during streaming.
  // Disengages automatically once a real thinking item arrives
  // (`hasRealThinking`) or the turn terminates (`isStreaming=false`).
  const SYNTHETIC_THINKING_ID = "thinking-live-synthetic";
  const hasRealThinking = mergedTimeline.some((i) => i.kind === "thinking");
  const hasAnyTool = mergedTimeline.some((i) => i.kind === "tool");
  const shouldSynthesizeThinking =
    isStreaming && !hasRealThinking && !thinkingText && hasAnyTool;
  if (shouldSynthesizeThinking) {
    mergedTimeline.unshift({
      kind: "thinking",
      id: SYNTHETIC_THINKING_ID,
      text: undefined,
      startMs: undefined,
      durationMs: undefined,
    } as TimelineItem);
  }

  // Phase 5 — feed-wide path disambiguation. Walk the file-op tool
  // entries reachable from this turn's timeline and compute the shortest
  // right-anchored tail that uniquely identifies each path within the
  // visible set. A lone `Cargo.toml` stays a bare basename; two reads of
  // `crates/aura-os-core/Cargo.toml` and `crates/aura-os-cli/Cargo.toml`
  // promote to their full distinguishing tails so operators can tell
  // identical-looking rows apart at a glance.
  const visibleFilePaths: string[] = [];
  for (const item of mergedTimeline) {
    if (item.kind !== "tool") continue;
    const entry = toolCallMap.get(item.toolCallId);
    if (!entry) continue;
    if (!FILE_OPS.has(entry.name)) continue;
    const raw = entry.input?.path;
    if (typeof raw === "string" && raw.length > 0) visibleFilePaths.push(raw);
  }
  const pathTailMap = computeUniquePathTails(visibleFilePaths);

  // Phase 5 — adjacent identical tool-call grouping. Walk the merged
  // timeline once and collapse runs of consecutive tool items sharing
  // `(tool_name, canonical_input)` into a single render slot pointing
  // at the *latest* entry in the run. The first non-matching item (or
  // any non-tool item) breaks the run. Non-tool items pass through
  // verbatim so thinking / text segments still interleave normally.
  interface TimelineSlot {
    item: TimelineItem;
    groupCount?: number;
  }
  const slots: TimelineSlot[] = [];
  let lastGroupKey: string | null = null;
  for (const item of mergedTimeline) {
    if (item.kind !== "tool") {
      slots.push({ item });
      lastGroupKey = null;
      continue;
    }
    const entry = toolCallMap.get(item.toolCallId);
    if (!entry) {
      lastGroupKey = null;
      continue;
    }
    const groupKey = canonicalInputKey(entry.name, entry.input ?? {});
    const prevSlot = slots[slots.length - 1];
    if (
      prevSlot &&
      prevSlot.item.kind === "tool" &&
      lastGroupKey === groupKey
    ) {
      prevSlot.item = item;
      prevSlot.groupCount = (prevSlot.groupCount ?? 1) + 1;
      continue;
    }
    slots.push({ item, groupCount: 1 });
    lastGroupKey = groupKey;
  }

  const items: RenderedItem[] = [];
  for (const slot of slots) {
    const item = slot.item;
    if (item.kind === "thinking") {
      // Prefer per-segment text (set by handleThinkingDelta) so that when
      // multiple thinking runs occur within one turn each block shows only
      // the text that actually belongs to it. Fall back to the global
      // `thinkingText` for historical messages that predate per-segment text.
      const segmentText = item.text ?? thinkingText;
      // Open live segments (no `durationMs` stamped, parent turn still
      // streaming) must render even with empty text so the shimmering
      // Brain "Thinking..." header is visible the instant a thinking
      // slot opens (real or synthetic). Closed/historical segments
      // without text still skip — this preserves the no-phantom-block
      // behavior on hydrated terminal turns.
      const isOpenLiveSegment = isStreaming && item.durationMs == null;
      if (!segmentText && !isOpenLiveSegment) continue;
      // Derive a per-segment streaming flag instead of forwarding the
      // turn-level `isStreaming` to every block. Without this, a
      // multi-segment turn (thinking -> tool -> thinking) used to render
      // every block as "Thinking..." with shimmer and `forceExpanded`,
      // even though `closeCurrentThinkingSegment` had already stamped
      // `durationMs` on the earlier segment. `handleThinkingDelta`
      // guarantees at most one open thinking segment at a time (it
      // extends the trailing thinking item instead of pushing a new
      // one), so "no `durationMs`" uniquely identifies the live segment
      // during a turn. Hydrated history rows have no `durationMs`
      // either, but the turn-level `isStreaming` is already `false`
      // there, so this rule still resolves correctly.
      const segmentIsStreaming = isStreaming && item.durationMs == null;
      items.push({
        key: item.id,
        kind: "thinking",
        toolPosition: null,
        node: (
          <ThinkingBlock
            text={segmentText ?? ""}
            isStreaming={segmentIsStreaming}
            // Prefer the per-segment `durationMs` stamped by
            // `closeCurrentThinkingSegment`; fall back to the
            // turn-level total for hydrated history rows that
            // predate per-segment tracking. This is what stops
            // multi-segment turns from rendering the same
            // "Thought for X" label on every block.
            durationMs={item.durationMs ?? thinkingDurationMs}
            defaultExpanded={defaultThinkingExpanded}
          />
        ),
      });
    } else if (item.kind === "tool") {
      const entry = toolCallMap.get(item.toolCallId);
      if (!entry) continue;
      // Just-finalized bubbles (defaultActivitiesExpanded=true) mirror the
      // StreamingBubble's state so the tools with rich live previews stay
      // visible. Historical bubbles (false) and reads/lists/deletes stay
      // collapsed so the turn reads as a tight checklist.
      const auto = isAutoExpandedTool(entry.name);
      const defaultToolExpanded = defaultActivitiesExpanded
        ? auto
        : entry.pending && auto;
      // Surface the feed-wide disambiguating tail for file ops and the
      // collapsed-run badge count for any tool whose previous adjacent
      // siblings shared its `(name, input)` fingerprint.
      let displayPath: string | undefined;
      if (FILE_OPS.has(entry.name)) {
        const raw = entry.input?.path;
        if (typeof raw === "string" && raw.length > 0) {
          displayPath = pathTailMap.get(raw);
        }
      }
      const groupCount =
        slot.groupCount && slot.groupCount >= 2 ? slot.groupCount : undefined;
      items.push({
        key: item.id,
        kind: "tool",
        // Position is filled in by a second pass below once we know each
        // tool row's neighbours.
        toolPosition: "solo",
        node: renderToolBlock(entry, defaultToolExpanded, {
          displayPath,
          groupCount,
        }),
      });
    } else {
      const normalized = normalizeLooseStrongEmphasis(
        flattenListIndentation(normalizeMidSentenceBreaks(stripEmojis(item.content))),
      );
      items.push({
        key: item.id,
        kind: "text",
        toolPosition: null,
        node: <SegmentedContent content={normalized} isStreaming={isStreaming} />,
      });
    }
  }

  // Mark each tool row with its position inside a run of adjacent tools
  // (`first`, `mid`, `last`, `solo`). The wrapper `<div className="toolGroup">`
  // that previously enclosed each run has been replaced by per-row data
  // attributes so each row can live in its own virtualizer slot. The styling
  // owned by `.toolGroup` in `ActivityTimeline.module.css` now lives behind
  // these data attributes via adjacent-sibling selectors.
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind !== "tool") continue;
    const prevIsTool = i > 0 && items[i - 1].kind === "tool";
    const nextIsTool = i < items.length - 1 && items[i + 1].kind === "tool";
    let pos: ToolPosition;
    if (!prevIsTool && !nextIsTool) pos = "solo";
    else if (!prevIsTool && nextIsTool) pos = "first";
    else if (prevIsTool && nextIsTool) pos = "mid";
    else pos = "last";
    items[i] = { ...items[i], toolPosition: pos };
  }

  return scrollRef ? (
    <VirtualizedTimeline items={items} scrollRef={scrollRef} />
  ) : (
    <PlainTimeline items={items} />
  );
}

function rowDataAttrs(item: RenderedItem): Record<string, string> {
  const attrs: Record<string, string> = { "data-kind": item.kind };
  if (item.kind === "tool" && item.toolPosition) {
    attrs["data-tool-position"] = item.toolPosition;
  }
  return attrs;
}

function PlainTimeline({ items }: { items: RenderedItem[] }) {
  return (
    <div className={styles.timeline}>
      {items.map((item) => (
        <div key={item.key} {...rowDataAttrs(item)}>
          <TimelineRow node={item.node} />
        </div>
      ))}
    </div>
  );
}

function VirtualizedTimeline({
  items,
  scrollRef,
}: {
  items: RenderedItem[];
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin(wrapperRef, scrollRef);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    // Tool blocks are usually compact (collapsed headers); thinking and
    // text segments are larger. 96px is a reasonable midpoint that keeps
    // the initial total size close to reality before measureElement
    // settles each row.
    estimateSize: () => 96,
    overscan: 6,
    getItemKey: (index) => items[index]?.key ?? index,
    scrollMargin,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={wrapperRef}
      className={`${styles.timeline} ${styles.timelineVirtual}`}
      style={{ height: `${totalSize}px` }}
    >
      {virtualItems.map((vi) => {
        const item = items[vi.index];
        if (!item) return null;
        return (
          <div
            key={vi.key}
            ref={virtualizer.measureElement}
            data-index={vi.index}
            {...rowDataAttrs(item)}
            className={styles.virtualRow}
            style={{
              transform: `translateY(${vi.start - scrollMargin}px)`,
            }}
          >
            <TimelineRow node={item.node} />
          </div>
        );
      })}
    </div>
  );
}
