import { createContext, useContext } from "react";
import type { GalleryItem } from "./Gallery";

/**
 * Aggregated list of every image in the current chat session
 * (`null` when no provider is mounted — e.g. inside non-chat surfaces
 * such as the standalone aura3d `ImagePreview`, or in isolated
 * component tests). Click handlers in `MessageBubble` and `ImageBlock`
 * read from this context to call `openGallery` with the full
 * session-wide list, enabling forward/back navigation across every
 * image in the transcript instead of just the message that was
 * clicked.
 *
 * Provider is mounted by
 * [ChatMessageList.tsx](../../features/chat-ui/ChatMessageList/ChatMessageList.tsx)
 * with a `useMemo`-stabilised list computed by `collectSessionImages`.
 */
export const SessionGalleryContext = createContext<readonly GalleryItem[] | null>(null);

/**
 * Read the session-wide gallery list. Returns `null` when no provider
 * is mounted so callers can transparently fall back to whatever
 * single-source list they were already building (preserves legacy
 * behavior in isolated component tests and on non-chat surfaces).
 */
export function useSessionGalleryItems(): readonly GalleryItem[] | null {
  return useContext(SessionGalleryContext);
}
