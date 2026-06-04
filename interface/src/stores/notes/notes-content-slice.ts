import type { StateCreator } from "zustand";
import { api } from "../../api/client";
import { uploadMarkdown } from "../../api/upload";
import { isAuraCaptureSessionActive } from "../../lib/screenshot-bridge";
import { clearLastNote } from "../../utils/storage";
import {
  countWords,
  extractTitleFromContent,
  isErrorWithStatus,
  makeNoteKey,
  schedulePersist,
  slugify,
  type NoteContent,
  type NotesProjectTree,
} from "./notes-utils";
import type { NotesStore } from "./notes-store";

export interface ContentSlice {
  contentCache: Record<string, NoteContent>;
  readNote: (projectId: string, noteId: string) => Promise<NoteContent | null>;
  updateContent: (projectId: string, noteId: string, content: string) => void;
  flushNote: (projectId: string, noteId: string) => Promise<void>;
}

/**
 * Fetch a note's markdown body from its public S3 URL. Returns an empty
 * string when there is no body yet (newly-created note) or the fetch
 * fails, so the editor opens on a blank document rather than erroring.
 */
async function fetchBody(bodyUrl: string | null | undefined): Promise<string> {
  if (!bodyUrl) return "";
  try {
    const res = await fetch(bodyUrl);
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

/**
 * Per-note content + autosave slice. Owns `contentCache` and the
 * read/edit/debounced-flush pipeline. Note metadata is ID-based and the
 * markdown body is stored on S3: `readNote` fetches the body from
 * `bodyUrl`; `flushNote` re-uploads it and PUTs the new
 * `bodyUrl`/`bodyS3Key`/`title`/`slug`/`wordCount` onto the row.
 */
export const createContentSlice: StateCreator<
  NotesStore,
  [],
  [],
  ContentSlice
> = (set, get) => ({
  contentCache: {},

  readNote: async (projectId, noteId) => {
    const key = makeNoteKey(projectId, noteId);
    if (isAuraCaptureSessionActive()) {
      return get().contentCache[key] ?? null;
    }
    try {
      const note = await api.notes.getNote(projectId, noteId);
      const content = await fetchBody(note.bodyUrl);
      const entry: NoteContent = {
        content,
        title: note.title || extractTitleFromContent(content),
        note,
        updatedAt: note.updatedAt ?? undefined,
        wordCount: note.wordCount ?? countWords(content),
        dirty: false,
      };
      set((state) => ({
        contentCache: { ...state.contentCache, [key]: entry },
      }));
      return entry;
    } catch (err) {
      // If the stored active selection points at a note that no longer
      // exists, drop it so the UI falls back to an empty state rather
      // than a permanent "Loading…" spinner.
      if (isErrorWithStatus(err) && err.status === 404) {
        clearLastNote();
        set((state) => {
          const { [key]: _missing, ...restContent } = state.contentCache;
          const shouldClearActive =
            state.activeProjectId === projectId && state.activeNoteId === noteId;
          return {
            contentCache: restContent,
            activeProjectId: shouldClearActive ? null : state.activeProjectId,
            activeNoteId: shouldClearActive ? null : state.activeNoteId,
          };
        });
        return null;
      }
      set((state) => {
        const existing = state.contentCache[key];
        if (!existing) return state;
        return {
          contentCache: {
            ...state.contentCache,
            [key]: {
              ...existing,
              error: err instanceof Error ? err.message : "Failed to read note",
            },
          },
        };
      });
      return null;
    }
  },

  updateContent: (projectId, noteId, content) => {
    const key = makeNoteKey(projectId, noteId);
    const existing = get().contentCache[key];
    if (!existing) return;
    const title = extractTitleFromContent(content);
    const nextEntry: NoteContent = {
      ...existing,
      content,
      title: title || existing.title,
      wordCount: countWords(content),
      dirty: true,
      error: undefined,
    };
    set((state) => {
      const tree = state.trees[projectId];
      const nextTree: NotesProjectTree | undefined = tree
        ? {
            ...tree,
            titleOverrides: {
              ...tree.titleOverrides,
              [noteId]: title,
            },
          }
        : tree;
      return {
        contentCache: { ...state.contentCache, [key]: nextEntry },
        trees: nextTree ? { ...state.trees, [projectId]: nextTree } : state.trees,
      };
    });

    schedulePersist(key, () => {
      void get().flushNote(projectId, noteId);
    });
  },

  flushNote: async (projectId, noteId) => {
    const key = makeNoteKey(projectId, noteId);
    const entry = get().contentCache[key];
    if (!entry || !entry.dirty) return;
    const content = entry.content;
    const title = extractTitleFromContent(content) || entry.title || "Untitled";
    const slug = slugify(title) || noteId;
    const wordCount = countWords(content);
    try {
      const { url, key: bodyS3Key } = await uploadMarkdown(
        content,
        `${slug || noteId}.md`,
      );
      const updated = await api.notes.updateNote(projectId, noteId, {
        title,
        slug,
        bodyUrl: url,
        bodyS3Key,
        wordCount,
      });
      set((state) => {
        const current = state.contentCache[key];
        if (!current) return state;
        const nextEntry: NoteContent = {
          ...current,
          // Only clear `dirty` if no edit landed while the upload was in
          // flight (the content we just persisted still matches).
          dirty: current.content !== content,
          note: updated,
          updatedAt: updated.updatedAt ?? current.updatedAt,
          title: updated.title || current.title,
          wordCount: updated.wordCount ?? wordCount,
          error: undefined,
        };
        return {
          contentCache: { ...state.contentCache, [key]: nextEntry },
        };
      });
      get().patchNoteTitle(projectId, noteId, updated.title || title);
    } catch (err) {
      set((state) => {
        const current = state.contentCache[key];
        if (!current) return state;
        return {
          contentCache: {
            ...state.contentCache,
            [key]: {
              ...current,
              error: err instanceof Error ? err.message : "Failed to save note",
            },
          },
        };
      });
    }
  },
});
