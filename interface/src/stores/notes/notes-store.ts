import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { NoteComment } from "../../shared/api/notes";
import {
  createCommentsSlice,
  type CommentsSlice,
} from "./notes-comments-slice";
import {
  createContentSlice,
  type ContentSlice,
} from "./notes-content-slice";
import {
  createSidekickSlice,
  type SidekickSlice,
} from "./notes-sidekick-slice";
import { createTreeSlice, type TreeSlice } from "./notes-tree-slice";
import {
  makeNoteKey,
  type NoteContent,
  type NoteKey,
  type NotesProjectTree,
} from "./notes-utils";

export type NotesStore = TreeSlice & ContentSlice & CommentsSlice & SidekickSlice;

export const useNotesStore = create<NotesStore>()((...a) => ({
  ...createTreeSlice(...a),
  ...createContentSlice(...a),
  ...createCommentsSlice(...a),
  ...createSidekickSlice(...a),
}));

export function useActiveNote(): NoteContent | null {
  return useNotesStore(
    useShallow((s) => {
      if (!s.activeProjectId || !s.activeNoteId) return null;
      return s.contentCache[makeNoteKey(s.activeProjectId, s.activeNoteId)] ?? null;
    }),
  );
}

export function useActiveNoteKey(): NoteKey | null {
  return useNotesStore(
    useShallow((s) => {
      if (!s.activeProjectId || !s.activeNoteId) return null;
      return { projectId: s.activeProjectId, noteId: s.activeNoteId };
    }),
  );
}

export function useNotesTree(projectId: string | null): NotesProjectTree | null {
  return useNotesStore((s) => (projectId ? s.trees[projectId] ?? null : null));
}

export function useNoteComments(
  projectId: string | null,
  noteId: string | null,
): NoteComment[] {
  return useNotesStore(
    useShallow((s) => {
      if (!projectId || !noteId) return [];
      return s.commentsByNote[makeNoteKey(projectId, noteId)] ?? [];
    }),
  );
}
