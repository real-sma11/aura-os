/**
 * Identifiers parsed out of a chat `streamKey`. The project-chat
 * surface builds its key as `projectId:agentInstanceId:sessionId`
 * (see `useStreamCore` / `storeKey`), where `sessionId` is a fresh-canvas
 * placeholder until the first `SessionReady`. `sessionId` is `null`
 * when the key carries that placeholder (no persisted session yet).
 */
export interface ParsedStreamKey {
  projectId: string;
  agentInstanceId: string;
  sessionId: string | null;
}

/**
 * The fresh-canvas placeholder segment used by `useChatStream` before a
 * storage session exists. Kept in sync with
 * `FRESH_SESSION_PLACEHOLDER` in `hooks/use-chat-stream`; duplicated as a
 * literal here so this pure util has no stream-hook import dependency.
 */
const FRESH_SESSION_SEGMENT = "fresh";

/**
 * Parse a project-chat `streamKey` into its component ids. Segments are
 * `:`-joined and the underlying ids (UUIDs) never contain a colon, so a
 * plain split is unambiguous. Returns `null` when the key does not have
 * the expected three segments so callers can degrade gracefully rather
 * than read `undefined` ids.
 */
export function parseStreamKey(streamKey: string): ParsedStreamKey | null {
  const parts = streamKey.split(":");
  if (parts.length < 3) return null;
  const [projectId, agentInstanceId, sessionSegment] = parts;
  if (!projectId || !agentInstanceId || !sessionSegment) return null;
  return {
    projectId,
    agentInstanceId,
    sessionId: sessionSegment === FRESH_SESSION_SEGMENT ? null : sessionSegment,
  };
}
