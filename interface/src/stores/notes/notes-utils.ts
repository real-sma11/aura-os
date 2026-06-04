import type { Note, NoteFolder } from "../../shared/api/notes";

export const AUTOSAVE_DEBOUNCE_MS = 600;

export interface NoteKey {
  projectId: string;
  noteId: string;
}

export function makeNoteKey(projectId: string, noteId: string): string {
  return `${projectId}::${noteId}`;
}

export function parseNoteKey(key: string): NoteKey | null {
  const sepIndex = key.indexOf("::");
  if (sepIndex === -1) return null;
  return {
    projectId: key.slice(0, sepIndex),
    noteId: key.slice(sepIndex + 2),
  };
}

export function isErrorWithStatus(err: unknown): err is { status: number } {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  );
}

/**
 * Per-note content + autosave cache entry. The markdown body lives on
 * S3; `content` is the body text fetched from `note.bodyUrl`, and
 * `note` is the latest metadata row from the API.
 */
export interface NoteContent {
  content: string;
  title: string;
  /** Latest note metadata row from the API. */
  note: Note;
  updatedAt?: string;
  wordCount: number;
  /** Local-only draft that hasn't been flushed (uploaded) yet. */
  dirty: boolean;
  /** Most recent autosave error, if any. */
  error?: string;
}

/**
 * Per-project notes tree: the raw `folders` + `notes` rows from the
 * `/tree` endpoint plus load state and any live title overrides driven
 * by in-progress edits (keyed by noteId).
 */
export interface NotesProjectTree {
  folders: NoteFolder[];
  notes: Note[];
  loading: boolean;
  error?: string;
  titleOverrides: Record<string, string>;
}

export function emptyProjectTree(): NotesProjectTree {
  return { folders: [], notes: [], loading: true, titleOverrides: {} };
}

/** Extract a display title from the first non-empty line of markdown content. */
export function extractTitleFromContent(content: string): string {
  const lines = content.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i]?.trim() !== "---") i += 1;
    if (i < lines.length) i += 1;
  }
  for (; i < lines.length; i += 1) {
    const trimmed = lines[i]?.trim() ?? "";
    if (!trimmed) continue;
    return trimmed.replace(/^#+\s*/, "").trim();
  }
  return "";
}

export function countWords(body: string): number {
  return body
    .replace(/^---[\s\S]*?---/, "")
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Derive a URL-safe slug from a title: lowercase, non-alphanumerics
 * collapsed to single hyphens, trimmed. Falls back to `""` when the
 * title has no usable characters (callers substitute the noteId).
 */
export function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Per-note debounce timers shared by the content slice's autosave path.
 * Lives at module scope so successive edits collapse onto the same
 * timer key.
 */
export const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function schedulePersist(key: string, run: () => void): void {
  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingTimers.delete(key);
    run();
  }, AUTOSAVE_DEBOUNCE_MS);
  pendingTimers.set(key, timer);
}

/** Returns ms timeout so tests can override the debounce. */
export const NOTES_AUTOSAVE_DEBOUNCE_MS = AUTOSAVE_DEBOUNCE_MS;
