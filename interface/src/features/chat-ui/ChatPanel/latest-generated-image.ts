import type { DisplaySessionEvent } from "../../../shared/types/stream";
import { extractToolImage, type ToolImage } from "../../../shared/utils/extract-tool-image";

/**
 * The minimal "source image" shape the chat 3D mode needs to dispatch
 * an image-to-3D conversion against the AURA 3D backend. Mirrors the
 * fields produced by a successful `generate_image` tool call event
 * (see [ImageBlock.tsx](../../../../components/Block/renderers/ImageBlock.tsx))
 * so the same JSON payload feeds both the gallery render and the 3D
 * source thumb.
 */
export type LatestGeneratedImage = ToolImage;

/**
 * Walk a chat event list newest -> oldest looking for the most recent
 * successful `generate_image` tool result and return its public URL.
 * Returns `null` when the thread contains no usable image.
 *
 * Used by `ChatPanel` to one-shot seed the chat 3D mode's pinned source
 * thumb when the user enters 3D mode and the thread already contains
 * a generated image — preserving the "generate in Image mode → switch
 * to 3D → send" power-user shortcut. Once seeded (or after the first
 * in-bar image step lands), the pin is owned by `chat-ui-store`'s
 * `pinnedSourceImage` slice and this helper is no longer consulted.
 * Manual file attachments are intentionally NOT considered — the
 * router's data-URL 3D path is still disabled.
 */
export function findLatestGeneratedImage(
  messages: readonly DisplaySessionEvent[] | undefined,
): LatestGeneratedImage | null {
  if (!messages || messages.length === 0) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const event = messages[i];
    const tools = event.toolCalls;
    if (!tools || tools.length === 0) continue;
    for (let j = tools.length - 1; j >= 0; j -= 1) {
      const tool = tools[j];
      if (tool.name !== "generate_image") continue;
      const image = extractToolImage(tool);
      if (image) return image;
    }
  }
  return null;
}
