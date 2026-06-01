import { create } from "zustand";

/**
 * Wire shape of one rendered entry inside a context bucket (a single
 * tool definition, skill, subagent, or MCP server). Mirrors the
 * snake_case-free `label`/`text`/`tokens` fields in
 * `crates/aura-protocol/src/server.rs::ContextSegment` and
 * `interface/src/shared/types/harness-protocol.ts::ContextSegment`.
 *
 * Every field is optional here (unlike the strict protocol binding)
 * because this is the untrusted boundary shape the `context-contents`
 * endpoint decodes; the camelCase mapper below fills defensive
 * defaults so an older or partial harness payload never produces
 * `undefined` cells in the UI.
 */
export interface WireContextSegment {
  label?: string;
  text?: string;
  tokens?: number;
}

/**
 * Wire shape of the harness's `usage.context_contents` payload, served
 * lazily by `GET .../context-contents`. Mirrors the snake_case fields
 * in `crates/aura-protocol/src/server.rs::ContextContents` and
 * `interface/src/shared/types/harness-protocol.ts::ContextContents`.
 * Every field is optional because older harness builds omit them and
 * the camelCase mapper below treats missing buckets as empty.
 */
export interface WireContextContents {
  system_prompt?: string | null;
  tools?: WireContextSegment[];
  skills?: WireContextSegment[];
  subagents?: WireContextSegment[];
  mcp?: WireContextSegment[];
}

/**
 * Camel-cased rendered entry inside a context bucket, ready for the
 * preview UI. `ContextSegment` rather than `ContextItem` per the TS
 * naming rule.
 */
export interface ContextSegment {
  label: string;
  text: string;
  tokens: number;
}

/**
 * Camel-cased rendered text the harness counted for each static
 * context bucket. `systemPrompt` is undefined when the harness did not
 * emit one; each bucket defaults to an empty array so consumers can map
 * over it without a null check.
 */
export interface ContextContents {
  systemPrompt?: string;
  tools: ContextSegment[];
  skills: ContextSegment[];
  subagents: ContextSegment[];
  mcp: ContextSegment[];
}

/**
 * Map a list of wire segments into the camelCase shape, filling
 * defensive defaults so a partial payload never yields undefined
 * cells. Missing input collapses to an empty list.
 */
function mapWireSegments(segments: WireContextSegment[] | undefined): ContextSegment[] {
  if (!segments) return [];
  return segments.map((segment) => ({
    label: segment.label ?? "",
    text: segment.text ?? "",
    tokens: segment.tokens ?? 0,
  }));
}

/**
 * Map the harness's snake_case `context_contents` payload into the
 * store's camelCase {@link ContextContents} shape. Returns `undefined`
 * when the input itself is missing (the "not available from this
 * harness build yet" sentinel). A present-but-sparse payload maps to a
 * value with an undefined system prompt and empty bucket lists, never
 * to `undefined`, so callers can distinguish "absent" from "empty".
 */
export function mapWireContextContents(
  cc: WireContextContents | undefined,
): ContextContents | undefined {
  if (!cc) return undefined;
  const systemPrompt =
    typeof cc.system_prompt === "string" && cc.system_prompt.length > 0
      ? cc.system_prompt
      : undefined;
  return {
    systemPrompt,
    tools: mapWireSegments(cc.tools),
    skills: mapWireSegments(cc.skills),
    subagents: mapWireSegments(cc.subagents),
    mcp: mapWireSegments(cc.mcp),
  };
}

interface ContextContentsState {
  /**
   * Mapped camelCase contents cached per `streamKey` so each row click
   * in the Context Composition popover reuses the lazily-fetched
   * payload instead of refetching.
   */
  contentsByStreamKey: Record<string, ContextContents>;
  setContextContents: (key: string, contents: ContextContents) => void;
  clearContextContents: (key: string) => void;
}

export const useContextContentsStore = create<ContextContentsState>((set) => ({
  contentsByStreamKey: {},
  setContextContents: (key, contents) =>
    set((state) => ({
      contentsByStreamKey: { ...state.contentsByStreamKey, [key]: contents },
    })),
  clearContextContents: (key) =>
    set((state) => {
      if (!(key in state.contentsByStreamKey)) return state;
      const rest = { ...state.contentsByStreamKey };
      delete rest[key];
      return { contentsByStreamKey: rest };
    }),
}));

/** Read the cached camelCase contents for a stream, if any. */
export function useContextContents(streamKey: string): ContextContents | undefined {
  return useContextContentsStore((state) => state.contentsByStreamKey[streamKey]);
}
