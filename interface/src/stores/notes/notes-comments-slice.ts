import type { StateCreator } from "zustand";
import { api } from "../../api/client";
import { isAuraCaptureSessionActive } from "../../lib/screenshot-bridge";
import type { NoteComment } from "../../shared/api/notes";
import { useAuthStore } from "../auth-store";
import { makeNoteKey } from "./notes-utils";
import type { NotesStore } from "./notes-store";

export interface CommentsSlice {
  commentsByNote: Record<string, NoteComment[]>;
  loadComments: (projectId: string, noteId: string) => Promise<void>;
  addComment: (
    projectId: string,
    noteId: string,
    body: string,
  ) => Promise<void>;
  deleteComment: (
    projectId: string,
    noteId: string,
    commentId: string,
  ) => Promise<void>;
}

/**
 * Comments slice — owns the per-note comment list (`commentsByNote`,
 * keyed by `projectId::noteId`) and the load/add/delete actions. The
 * author display name is read from the auth store rather than threaded
 * through arguments.
 */
export const createCommentsSlice: StateCreator<
  NotesStore,
  [],
  [],
  CommentsSlice
> = (set) => ({
  commentsByNote: {},

  loadComments: async (projectId, noteId) => {
    const key = makeNoteKey(projectId, noteId);
    if (isAuraCaptureSessionActive()) {
      set((state) => ({
        commentsByNote: {
          ...state.commentsByNote,
          [key]: state.commentsByNote[key] ?? [],
        },
      }));
      return;
    }
    try {
      const comments = await api.notes.listComments(projectId, noteId);
      set((state) => ({
        commentsByNote: { ...state.commentsByNote, [key]: comments },
      }));
    } catch (err) {
      console.warn("load comments failed", err);
    }
  },

  addComment: async (projectId, noteId, body) => {
    const key = makeNoteKey(projectId, noteId);
    const user = useAuthStore.getState().user;
    try {
      const comment = await api.notes.addComment(
        projectId,
        noteId,
        body,
        user?.display_name,
      );
      set((state) => ({
        commentsByNote: {
          ...state.commentsByNote,
          [key]: [...(state.commentsByNote[key] ?? []), comment],
        },
      }));
    } catch (err) {
      console.warn("add comment failed", err);
    }
  },

  deleteComment: async (projectId, noteId, commentId) => {
    const key = makeNoteKey(projectId, noteId);
    try {
      await api.notes.deleteComment(projectId, noteId, commentId);
      set((state) => ({
        commentsByNote: {
          ...state.commentsByNote,
          [key]: (state.commentsByNote[key] ?? []).filter(
            (c) => c.id !== commentId,
          ),
        },
      }));
    } catch (err) {
      console.warn("delete comment failed", err);
    }
  },
});
