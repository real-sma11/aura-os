import type { DisplaySessionEvent, DisplayImageBlock } from "../../../shared/types/stream";
import type { GalleryItem } from "../../../components/Gallery";
import { extractToolImage } from "../../../shared/utils/extract-tool-image";

/**
 * Resolve a user-attached `DisplayImageBlock` to a renderable URL.
 * Prefers the S3 `source_url` when present, falling back to the
 * inline base64 payload. Mirrors the helper in
 * [MessageBubble.tsx](../../../apps/chat/components/MessageBubble/MessageBubble.tsx)
 * so the gallery's `src` exactly matches what the bubble renders
 * inline — required for the click-target's thumbnail to dissolve
 * straight into the corresponding lightbox slide without re-fetch.
 */
function imageBlockSrc(block: DisplayImageBlock): string {
  if (block.source_url) return block.source_url;
  return `data:${block.media_type};base64,${block.data}`;
}

/**
 * Walk the entire chat transcript in chronological order and collect
 * every renderable image — both user attachments (`contentBlocks` of
 * type `image`) and assistant-generated `generate_image` tool results —
 * into a single ordered `GalleryItem[]`.
 *
 * The aggregated list is published via `SessionGalleryContext` from
 * [ChatMessageList.tsx](./ChatMessageList.tsx) so any click handler
 * inside the transcript (user-attachment thumbnails in `MessageBubble`,
 * generated-image thumbnails in `ImageBlock`) can call
 * `openGallery({ items, initialId })` with the full session-wide list
 * and the clicked image's id — letting the user page forward/back
 * through every image they've ever seen in this chat without each
 * surface having to re-aggregate independently.
 *
 * Id scheme is deliberately stable and matches the per-surface ids the
 * click handlers already produce:
 *   - User attachments: `${message.id}-img-${blockIndex}`
 *   - Assistant generations: `${tool_call_id}` (i.e. `entry.id`)
 *
 * Pending and errored tool calls are skipped via `extractToolImage`,
 * so an in-flight generation does not appear as a broken slide. The
 * function is pure and cheap enough to call on every render of the
 * message list — wrap it in `useMemo(..., [messages])` at the call
 * site to avoid re-running on unrelated rerenders.
 */
export function collectSessionImages(
  messages: readonly DisplaySessionEvent[] | undefined,
): GalleryItem[] {
  if (!messages || messages.length === 0) return [];
  const items: GalleryItem[] = [];
  for (const message of messages) {
    if (message.contentBlocks) {
      message.contentBlocks.forEach((block, blockIndex) => {
        if (block.type !== "image") return;
        items.push({
          id: `${message.id}-img-${blockIndex}`,
          src: imageBlockSrc(block),
          alt: "Attached image",
        });
      });
    }
    if (message.toolCalls) {
      for (const tool of message.toolCalls) {
        if (tool.name !== "generate_image") continue;
        const image = extractToolImage(tool);
        if (!image) continue;
        items.push({
          id: image.id,
          src: image.imageUrl,
          alt: image.prompt ?? "Generated image",
          downloadUrl: image.originalUrl || image.imageUrl,
          caption: image.prompt,
        });
      }
    }
  }
  return items;
}
