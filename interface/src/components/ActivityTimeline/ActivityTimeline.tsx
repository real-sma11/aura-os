import { Fragment, useMemo, type ReactNode } from "react";
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
}

interface RenderedItem {
  key: string;
  kind: string;
  node: ReactNode;
}

export function ActivityTimeline({
  timeline,
  thinkingText,
  thinkingDurationMs,
  toolCalls,
  isStreaming,
  defaultThinkingExpanded,
  defaultActivitiesExpanded,
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
      if (!segmentText) continue;
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
        node: (
          <ThinkingBlock
            text={segmentText}
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
        node: <SegmentedContent content={normalized} isStreaming={isStreaming} />,
      });
    }
  }

  const groups: ReactNode[] = [];
  let i = 0;
  while (i < items.length) {
    const current = items[i];
    if (current.kind === "tool") {
      const toolItems: RenderedItem[] = [];
      while (i < items.length && items[i].kind === "tool") {
        toolItems.push(items[i]);
        i++;
      }
      groups.push(
        <div key={`toolgroup-${toolItems[0].key}`} className={styles.toolGroup}>
          {toolItems.map((t) => (
            <Fragment key={t.key}>{t.node}</Fragment>
          ))}
        </div>,
      );
    } else {
      groups.push(
        <div key={current.key} data-kind={current.kind}>
          {current.node}
        </div>,
      );
      i++;
    }
  }

  return <div className={styles.timeline}>{groups}</div>;
}
