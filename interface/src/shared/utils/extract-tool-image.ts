import type { ToolCallEntry } from "../../shared/types/stream";

/**
 * Shared parsed shape returned by image-producing tool calls (currently
 * `generate_image`). Centralises the URL/prompt extraction logic that
 * was previously duplicated across
 * [features/chat-ui/ChatPanel/latest-generated-image.ts](../features/chat-ui/ChatPanel/latest-generated-image.ts)
 * and [components/Block/renderers/ImageBlock.tsx](../components/Block/renderers/ImageBlock.tsx).
 *
 * Kept generic across the various result shapes the AI image backends
 * have produced over time (top-level `imageUrl`, snake_case
 * `image_url`, nested `payload.image_url`, artifact-style `assetUrl`,
 * etc.) so a single parser covers every historical message we replay
 * out of the persisted session log.
 */
export interface ToolImage {
  /** Tool-call id; stable across re-renders and used as a gallery key. */
  id: string;
  imageUrl: string;
  /** Pre-postprocessing original asset, when the backend supplies one. */
  originalUrl?: string;
  /** Server-side artifact id, when available. */
  artifactId?: string;
  /** Prompt the user (or the agent) supplied for this generation. */
  prompt?: string;
}

function parseToolResult(result: string | null | undefined): Record<string, unknown> | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Pull the image URL + prompt out of a single tool-call entry. Returns
 * `null` for entries that are still pending, errored, or simply not
 * carrying an image-shaped payload — letting callers do a tight
 * `.map(...).filter(Boolean)` walk without re-implementing the field
 * fallbacks each time.
 */
export function extractToolImage(entry: ToolCallEntry): ToolImage | null {
  if (entry.pending || entry.isError) return null;
  const data = parseToolResult(entry.result);
  if (!data) return null;
  const payload =
    data.payload && typeof data.payload === "object"
      ? (data.payload as Record<string, unknown>)
      : null;
  const imageUrl = (
    data.imageUrl ??
    data.url ??
    data.image_url ??
    data.assetUrl ??
    data.asset_url ??
    payload?.imageUrl ??
    payload?.url ??
    payload?.image_url ??
    payload?.assetUrl ??
    payload?.asset_url
  ) as string | undefined;
  if (!imageUrl || typeof imageUrl !== "string") return null;
  const originalUrl = (
    data.originalUrl ??
    data.original_url ??
    payload?.originalUrl ??
    payload?.original_url
  ) as string | undefined;
  const artifactId = (data.artifactId ?? payload?.artifactId) as string | undefined;
  const prompt =
    (data.prompt as string | undefined) ??
    ((data as { meta?: { prompt?: string } } | null)?.meta?.prompt) ??
    (entry.input?.prompt as string | undefined);
  return {
    id: entry.id,
    imageUrl,
    originalUrl: typeof originalUrl === "string" ? originalUrl : undefined,
    artifactId: typeof artifactId === "string" ? artifactId : undefined,
    prompt: typeof prompt === "string" ? prompt : undefined,
  };
}
