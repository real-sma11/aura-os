import type { StateCreator } from "zustand";
import { api } from "../../api/client";
import { isAuraCaptureSessionActive } from "../../lib/screenshot-bridge";
import { clearLastNote } from "../../utils/storage";
import { emptyProjectTree, slugify, type NotesProjectTree } from "./notes-utils";
import type { NotesStore } from "./notes-store";

export interface TreeSlice {
  trees: Record<string, NotesProjectTree>;
  loadTree: (projectId: string) => Promise<void>;
  createNote: (
    projectId: string,
    folderId: string | null,
    title?: string,
  ) => Promise<{ noteId: string } | null>;
  createFolder: (
    projectId: string,
    parentId: string | null,
    name: string,
  ) => Promise<{ folderId: string } | null>;
  deleteEntry: (
    projectId: string,
    kind: "note" | "folder",
    id: string,
  ) => Promise<void>;
  renameEntry: (
    projectId: string,
    kind: "note" | "folder",
    id: string,
    name: string,
  ) => Promise<void>;
  /** Patch a note's title in the loaded tree without a full reload. */
  patchNoteTitle: (projectId: string, noteId: string, title: string) => void;
}

/**
 * Tree CRUD slice — owns the per-project notes tree (`trees`, holding
 * raw `folders` + `notes` rows) and the ID-based actions that mutate
 * the note hierarchy. Cross-slice `selectNote` / `clearLastNote`
 * cleanup on delete is reached through `get()`.
 */
export const createTreeSlice: StateCreator<NotesStore, [], [], TreeSlice> = (
  set,
  get,
) => ({
  trees: {},

  loadTree: async (projectId) => {
    if (isAuraCaptureSessionActive() && get().trees[projectId]) {
      set((state) => ({
        trees: {
          ...state.trees,
          [projectId]: {
            ...state.trees[projectId],
            loading: false,
            error: undefined,
          },
        },
      }));
      return;
    }
    set((state) => ({
      trees: {
        ...state.trees,
        [projectId]: {
          ...(state.trees[projectId] ?? emptyProjectTree()),
          loading: true,
          error: undefined,
        },
      },
    }));
    try {
      const res = await api.notes.tree(projectId);
      set((state) => ({
        trees: {
          ...state.trees,
          [projectId]: {
            folders: res.folders,
            notes: res.notes,
            loading: false,
            titleOverrides: state.trees[projectId]?.titleOverrides ?? {},
          },
        },
      }));
    } catch (err) {
      set((state) => ({
        trees: {
          ...state.trees,
          [projectId]: {
            ...(state.trees[projectId] ?? emptyProjectTree()),
            loading: false,
            error: err instanceof Error ? err.message : "Failed to load notes",
          },
        },
      }));
    }
  },

  createNote: async (projectId, folderId, title) => {
    try {
      const resolvedTitle = title?.trim() || "Untitled";
      const note = await api.notes.createNote(projectId, {
        title: resolvedTitle,
        slug: slugify(resolvedTitle) || undefined,
        folderId: folderId ?? undefined,
      });
      await get().loadTree(projectId);
      get().selectNote(projectId, note.id);
      return { noteId: note.id };
    } catch (err) {
      console.warn("create note failed", err);
      return null;
    }
  },

  createFolder: async (projectId, parentId, name) => {
    try {
      const folder = await api.notes.createFolder(projectId, {
        name,
        parentId: parentId ?? undefined,
      });
      await get().loadTree(projectId);
      return { folderId: folder.id };
    } catch (err) {
      console.warn("create folder failed", err);
      return null;
    }
  },

  deleteEntry: async (projectId, kind, id) => {
    try {
      if (kind === "note") {
        await api.notes.deleteNote(projectId, id);
      } else {
        await api.notes.deleteFolder(projectId, id);
      }
      await get().loadTree(projectId);
      const { activeProjectId, activeNoteId } = get();
      if (
        kind === "note" &&
        activeProjectId === projectId &&
        activeNoteId === id
      ) {
        set({ activeNoteId: null });
        clearLastNote();
      }
    } catch (err) {
      console.warn("delete entry failed", err);
      throw err;
    }
  },

  renameEntry: async (projectId, kind, id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      if (kind === "note") {
        await api.notes.updateNote(projectId, id, {
          title: trimmed,
          slug: slugify(trimmed) || undefined,
        });
      } else {
        await api.notes.updateFolder(projectId, id, { name: trimmed });
      }
      await get().loadTree(projectId);
    } catch (err) {
      console.warn("rename entry failed", err);
    }
  },

  patchNoteTitle: (projectId, noteId, title) => {
    set((state) => {
      const tree = state.trees[projectId];
      if (!tree) return state;
      let changed = false;
      const notes = tree.notes.map((n) => {
        if (n.id !== noteId || n.title === title) return n;
        changed = true;
        return { ...n, title };
      });
      if (!changed) return state;
      return {
        trees: { ...state.trees, [projectId]: { ...tree, notes } },
      };
    });
  },
});
